// PDF Navigator App Version: 1.2.5

// Import PDF.js worker for module compatibility
import * as pdfjsLib from 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.min.mjs';

// Set the worker source for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs';

// Initialize variables
let pdfDoc = null; // Holds the loaded PDF document
let currentPage = 1; // Tracks the current page
let scale = 1.0; // Default scale for rendering
let pageNumberMap = new Map(); // Maps page numbers to page indices

// DOM elements
const uploadInput = document.getElementById('upload');
const menuDiv = document.getElementById('menu');
const documentContainer = document.getElementById('documentContainer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const versionDiv = document.getElementById('version');

// Set version display
versionDiv.textContent = 'Version: 1.2.5';

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
    } catch (error) {
        console.error('Error loading PDF:', error);
        menuDiv.innerHTML = '<div id="no-pdf">Failed to load PDF. Try again.</div>';
    }
});

// Extract page numbers from each page and render all pages
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

        // Extract text for page number detection
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ').trim();
        // Look for a number at the bottom (last 10% of page height)
        const bottomText = textContent.items
            .filter(item => item.transform[5] < viewport.height * 0.1)
            .map(item => item.str)
            .join(' ')
            .trim();
        // Extract the last number as the page number
        const pageNumberMatch = bottomText.match(/\d+$/);
        if (pageNumberMatch) {
            const pageNumber = parseInt(pageNumberMatch[0], 10);
            if (pageNumber > 0 && pageNumber <= numPages) {
                pageNumberMap.set(pageNumber, pageNum);
            }
        }
    }
}

// Extract and display embedded Table of Contents
async function displayTOC() {
    try {
        const outline = await pdfDoc.getOutline();
        if (!outline || outline.length === 0) {
            return false; // No embedded TOC found
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
            });
            li.appendChild(a);

            // Handle nested items
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
                    });
                    subLi.appendChild(subA);
                    subUl.appendChild(subLi);
                });
                li.appendChild(subUl);
            }
            ul.appendChild(li);
        });
        menuDiv.appendChild(ul);
        return true; // TOC successfully extracted
    } catch (error) {
        console.error('Error extracting TOC:', error);
        return false;
    }
}

// Fallback: Detect TOC using Tesseract.js OCR
async function detectTOCWithOCR() {
    try {
        menuDiv.innerHTML = '<div id="loading">Scanning for TOC...</div>';
        const numPagesToScan = Math.min(pdfDoc.numPages, 10); // Scan up to 10 pages
        let tocItems = [];

        for (let pageNum = 1; pageNum <= numPagesToScan; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Render page to canvas for OCR
            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            // Perform OCR using Tesseract.js
            const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
                logger: (m) => console.log(m) // Optional: log OCR progress
            });

            // Detect TOC: lines with text followed by a number (e.g., "Title 5" or "Title .... 5")
            const lines = text.split('\n').map(line => line.trim()).filter(line => line);
            lines.forEach(line => {
                // Match patterns like "Title 5" or "Title .... 5"
                const match = line.match(/^(.+?)\s*(?:\.{2,}|\s+)\s*(\d+)$/);
                if (match) {
                    const title = match[1].trim();
                    const page = parseInt(match[2], 10);
                    if (page > 0 && page <= pdfDoc.numPages) {
                        tocItems.push({ title, page });
                    }
                }
            });

            // Clean up canvas
            canvas.remove();

            // Stop scanning if TOC items are found
            if (tocItems.length > 0) break;
        }

        if (tocItems.length > 0) {
            // Create menu from detected TOC items
            const ul = document.createElement('ul');
            tocItems.forEach(item => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.textContent = item.title;
                a.href = '#';
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Use pageNumberMap to find the actual page index
                    const actualPageNum = pageNumberMap.get(item.page) || item.page;
                    currentPage = actualPageNum;
                    const pageDiv = document.getElementById(`page-${actualPageNum}`);
                    if (pageDiv) {
                        pageDiv.scrollIntoView({ behavior: 'smooth' });
                        updatePageControls();
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
}

// Previous page button
prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        document.getElementById(`page-${currentPage}`).scrollIntoView({ behavior: 'smooth' });
        updatePageControls();
    }
});

// Next page button
nextBtn.addEventListener('click', () => {
    if (currentPage < pdfDoc.numPages) {
        currentPage++;
        document.getElementById(`page-${currentPage}`).scrollIntoView({ behavior: 'smooth' });
        updatePageControls();
    }
});