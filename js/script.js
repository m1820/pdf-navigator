// PDF Navigator App Version: 1.2.7

// Import PDF.js worker for module compatibility
import * as pdfjsLib from 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.min.mjs';

// Set the worker source for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs';

// Initialize variables
let pdfDoc = null; // Holds the loaded PDF document
let currentPage = 1; // Tracks the current page
let scale = 1.0; // Default scale for rendering
let pageNumberMap = new Map(); // Maps printed page numbers to actual page indices

// DOM elements
const uploadInput = document.getElementById('upload');
const menuDiv = document.getElementById('menu');
const documentContainer = document.getElementById('documentContainer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const versionDiv = document.getElementById('version');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const fullScreenBtn = document.getElementById('fullScreenBtn');
const viewer = document.getElementById('viewer');
const sidebar = document.getElementById('sidebar');

// Set version display
versionDiv.textContent = 'Version: 1.2.7';

// Handle sidebar toggle
toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    toggleSidebarBtn.textContent = sidebar.classList.contains('collapsed') ? '☰ Menu' : '✕ Close';
});

// Handle zoom in
zoomInBtn.addEventListener('click', () => {
    scale += 0.2;
    if (scale > 3.0) scale = 3.0; // Max zoom
    reRenderPages();
});

// Handle zoom out
zoomOutBtn.addEventListener('click', () => {
    scale -= 0.2;
    if (scale < 0.5) scale = 0.5; // Min zoom
    reRenderPages();
});

// Handle full-screen toggle
fullScreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        viewer.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
        viewer.classList.add('fullscreen');
        fullScreenBtn.textContent = '↙ Exit';
        sidebar.classList.add('collapsed'); // Collapse sidebar in full-screen
        toggleSidebarBtn.textContent = '☰ Menu';
    } else {
        document.exitFullscreen();
        viewer.classList.remove('fullscreen');
        fullScreenBtn.textContent = '⤢';
    }
});

// Handle file upload
uploadInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file || !file.type.match('application/pdf')) {
        alert('Please upload a valid PDF file.');
        return;
    }

    // Show loading state
    menuDiv.innerHTML = '<div id="loading">Loading PDF...</div>';

    try {
        // Read the PDF file
        const arrayBuffer = await file.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Clear previous content
        documentContainer.innerHTML = '';
        menuDiv.innerHTML = '';
        pageNumberMap.clear();

        // Extract page numbers and render pages
        await extractPageNumbersAndRender();

        // Try to extract and display embedded TOC
        const tocExtracted = await displayTOC();
        if (!tocExtracted) {
            // Fallback to OCR-based TOC detection
            await detectTOCWithOCR();
        }

        // Update page controls
        updatePageControls();

        // Collapse sidebar on mobile after loading
        if (window.innerWidth <= 768) {
            sidebar.classList.add('collapsed');
            toggleSidebarBtn.textContent = '☰ Menu';
        }
    } catch (error) {
        console.error('Error loading PDF:', error);
        menuDiv.innerHTML = '<div id="no-pdf">Failed to load PDF. Try again.</div>';
    }
});

// Extract page numbers and render all pages
async function extractPageNumbersAndRender() {
    const numPages = pdfDoc.numPages;
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        // Create page container
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page-div';
        pageDiv.id = `page-${pageNum}`;

        // Add page number heading
        const pageHeading = document.createElement('h2');
        pageHeading.textContent = `Page ${pageNum}`;
        pageDiv.appendChild(pageHeading);

        // Create canvas for rendering
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        pageDiv.appendChild(canvas);

        // Render page
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        documentContainer.appendChild(pageDiv);

        // Try PDF.js text layer for page number
        let pageNumber = null;
        try {
            const textContent = await page.getTextContent();
            const bottomText = textContent.items
                .filter(item => item.transform[5] < viewport.height * 0.15)
                .map(item => item.str)
                .join(' ')
                .trim();
            const pageNumberMatch = bottomText.match(/\b\d+\b/);
            if (pageNumberMatch) {
                pageNumber = parseInt(pageNumberMatch[0], 10);
            }
        } catch (error) {
            console.warn('PDF.js text extraction failed for page', pageNum, error);
        }

        // Fallback to OCR if needed
        if (!pageNumber || pageNumber < 1 || pageNumber > numPages) {
            try {
                const ocrViewport = page.getViewport({ scale: 2.0 });
                const ocrCanvas = document.createElement('canvas');
                const ocrContext = ocrCanvas.getContext('2d');
                ocrCanvas.height = ocrViewport.height;
                ocrCanvas.width = ocrViewport.width;
                await page.render({
                    canvasContext: ocrContext,
                    viewport: ocrViewport
                }).promise;
                const { data: { text } } = await Tesseract.recognize(ocrCanvas, 'eng');
                const lines = text.split('\n').map(line => line.trim()).filter(line => line);
                const bottomLines = lines.slice(-5);
                const ocrPageNumberMatch = bottomLines
                    .map(line => line.match(/\b\d+\b/))
                    .filter(match => match)
                    .pop();
                if (ocrPageNumberMatch) {
                    pageNumber = parseInt(ocrPageNumberMatch[0], 10);
                }
                ocrCanvas.remove();
            } catch (error) {
                console.warn('OCR page number extraction failed for page', pageNum, error);
            }
        }

        if (pageNumber && pageNumber > 0 && pageNumber <= numPages) {
            pageNumberMap.set(pageNumber, pageNum);
        } else {
            pageNumberMap.set(pageNum, pageNum);
        }
    }
}

// Re-render pages with updated scale
async function reRenderPages() {
    documentContainer.innerHTML = '';
    await extractPageNumbersAndRender();
    const pageDiv = document.getElementById(`page-${currentPage}`);
    if (pageDiv) {
        pageDiv.scrollIntoView({ behavior: 'smooth' });
    }
    updatePageControls();
}

// Extract and display embedded Table of Contents
async function displayTOC() {
    try {
        const outline = await pdfDoc.getOutline();
        if (!outline || outline.length === 0) {
            return false;
        }

        const ul = document.createElement('ul');
        outline.forEach(item => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.textContent = item.title || 'Untitled';
            a.href = '#';
            a.addEventListener('click', (e) => {
                e.preventDefault();
                navigateToDest(item.dest);
                if (window.innerWidth <= 768) {
                    sidebar.classList.add('collapsed');
                    toggleSidebarBtn.textContent = '☰ Menu';
                }
            });
            li.appendChild(a);

            if (item.items && item.items.length > 0) {
                const subUl = document.createElement('ul');
                item.items.forEach(subItem => {
                    const subLi = document.createElement('li');
                    const subA = document.createElement('a');
                    subA.textContent = subItem.title || 'Untitled';
                    subA.href = '#';
                    subA.addEventListener('click', (e) => {
                        e.preventDefault();
                        navigateToDest(subItem.dest);
                        if (window.innerWidth <= 768) {
                            sidebar.classList.add('collapsed');
                            toggleSidebarBtn.textContent = '☰ Menu';
                        }
                    });
                    subLi.appendChild(subA);
                    subUl.appendChild(subLi);
                });
                li.appendChild(subUl);
            }
            ul.appendChild(li);
        });
        menuDiv.appendChild(ul);
        return true;
    } catch (error) {
        console.error('Error extracting TOC:', error);
        return false;
    }
}

// Fallback: Detect TOC using Tesseract.js OCR
async function detectTOCWithOCR() {
    try {
        menuDiv.innerHTML = '<div id="loading">Scanning for TOC...</div>';
        const numPagesToScan = Math.min(pdfDoc.numPages, 10);
        let tocItems = [];

        for (let pageNum = 1; pageNum <= numPagesToScan; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
                logger: (m) => console.log(m)
            });

            const lines = text.split('\n').map(line => line.trim()).filter(line => line);
            lines.forEach(line => {
                const match = line.match(/^(.+?)\s*(?:\.{2,}|[-–—\s]+)\s*(\d+)$/i);
                if (match) {
                    const title = match[1].trim().replace(/\s{2,}/g, ' ');
                    const page = parseInt(match[2], 10);
                    if (page > 0 && page <= pdfDoc.numPages) {
                        tocItems.push({ title, page });
                    }
                }
            });

            canvas.remove();
            if (tocItems.length > 0) break;
        }

        if (tocItems.length > 0) {
            const ul = document.createElement('ul');
            tocItems.forEach(item => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.textContent = item.title;
                a.href = '#';
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    const actualPageNum = pageNumberMap.get(item.page) || item.page;
                    currentPage = actualPageNum;
                    const pageDiv = document.getElementById(`page-${actualPageNum}`);
                    if (pageDiv) {
                        pageDiv.scrollIntoView({ behavior: 'smooth' });
                        updatePageControls();
                        if (window.innerWidth <= 768) {
                            sidebar.classList.add('collapsed');
                            toggleSidebarBtn.textContent = '☰ Menu';
                        }
                    } else {
                        console.warn('Page not found for TOC item:', item);
                    }
                });
                li.appendChild(a);
                ul.appendChild(li);
            });
            menuDiv.innerHTML = '';
            menuDiv.appendChild(ul);
        } else {
            menuDiv.innerHTML = '<div id="no-pdf">No TOC found. Use page controls.</div>';
        }
    } catch (error) {
        console.error('Error during OCR TOC detection:', error);
        menuDiv.innerHTML = '<div id="no-pdf">No TOC found. Use page controls.</div>';
    }
}

// Navigate to a destination (embedded TOC link)
async function navigateToDest(dest) {
    if (!dest) return;
    try {
        const ref = typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
        if (!ref) return;

        const pageIndex = await pdfDoc.getPageIndex(ref[0]);
        currentPage = pageIndex + 1;
        const pageDiv = document.getElementById(`page-${currentPage}`);
        if (pageDiv) {
            pageDiv.scrollIntoView({ behavior: 'smooth' });
            updatePageControls();
        }
    } catch (error) {
        console.error('Error navigating to destination:', error);
    }
}

// Update page navigation controls
function updatePageControls() {
    if (!pdfDoc) return;
    pageInfo.textContent = `Page ${currentPage} of ${pdfDoc.numPages}`;
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= pdfDoc.numPages;
    zoomInBtn.disabled = scale >= 3.0;
    zoomOutBtn.disabled = scale <= 0.5;
}