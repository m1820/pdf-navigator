// PDF Navigator App JavaScript
// Version 1.2.2
// Renders PDFs in canvas mode to preserve original appearance and generates a navigation menu for TOC-based page jumping

// Initialize PDF.js with CDN fallback to local files
let pdfjsLib;
try {
    // Attempt to load PDF.js from CDN
    pdfjsLib = await import('https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs';
} catch (e) {
    // Fallback to local PDF.js files if CDN fails
    console.warn('CDN failed, using local PDF.js');
    pdfjsLib = await import('/js/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.mjs';
}

// Application version for display in bottom-left corner
const APP_VERSION = '1.2.2';

// Global variables for PDF document and state
let pdfDoc = null; // Holds the loaded PDF document
let currentPage = 1; // Tracks the current page being viewed
const scale = 2.0; // Canvas rendering scale for PDF pages

// DOM elements for interaction
const upload = document.getElementById('upload'); // File input for PDF upload
const menuDiv = document.getElementById('menu'); // Sidebar menu for TOC
const viewer = document.getElementById('viewer'); // Main viewer area
const documentContainer = document.getElementById('documentContainer'); // Container for PDF pages
const versionDiv = document.getElementById('version'); // Version display element

// Display version number in bottom-left corner
if (versionDiv) versionDiv.textContent = `Version ${APP_VERSION}`;

// Event listener for PDF file selection
upload.addEventListener('change', handleFileSelect);

// Handle PDF file selection and initiate loading
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || !file.type.includes('pdf')) {
        alert('Please select a valid PDF file.');
        return;
    }

    if (file.size > 100 * 1024 * 1024) {
        alert('File too large (>100MB).');
        return;
    }

    // Show loading indicator and clear viewer
    menuDiv.innerHTML = '<div id="loading">Loading PDF...</div>';
    documentContainer.innerHTML = '';

    const arrayBuffer = await file.arrayBuffer();
    try {
        // Log loading start and track progress
        console.log('Starting PDF load for:', file.name, 'size:', file.size);
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        loadingTask.onProgress = (progress) => {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            menuDiv.innerHTML = `<div id="loading">Loading PDF... ${percent}%</div>`;
            console.log(`Loading progress: ${percent}%`);
        };
        // Timeout after 60 seconds to prevent hangs
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Loading timeout after 60s')), 60000));
        pdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
        console.log('PDF loaded:', pdfDoc.numPages, 'pages');

        currentPage = 1;
        // Reset navigation controls
        const controls = document.getElementById('pageControls');
        controls.innerHTML = '<button id="prevBtn" disabled>Previous</button><span id="pageInfo">Page 0 of 0</span><button id="nextBtn" disabled>Next</button>';
        pageInfo = document.getElementById('pageInfo');
        prevBtn = document.getElementById('prevBtn');
        nextBtn = document.getElementById('nextBtn');
        prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
        nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
        updatePageControls();

        // Render PDF in canvas mode
        await renderPdfCanvas();
        // Build navigation menu
        await buildMenu(file.name);
    } catch (error) {
        // Handle loading errors (e.g., corrupt PDF, network issues)
        console.error('PDF load error:', error);
        alert(`Error: ${error.message}. Check console (F12). Try re-downloading the PDF or using Chrome incognito.`);
        menuDiv.innerHTML = '<p>Error loading.</p>';
    }
}

// Render PDF pages in canvas mode to preserve original appearance
async function renderPdfCanvas() {
    const container = document.getElementById('documentContainer');
    container.innerHTML = '<div id="loading">Rendering PDF...</div>';

    try {
        console.log('Rendering PDF in canvas mode.');
        for (let p = 1; p <= pdfDoc.numPages; p++) {
            const pageDiv = document.createElement('div');
            pageDiv.id = `page-${p}`;
            pageDiv.className = 'page-div';
            const pageCanvas = document.createElement('canvas');
            pageCanvas.id = `canvas-${p}`;
            pageCanvas.style.border = '1px solid #ddd';
            pageDiv.appendChild(pageCanvas);
            const pageLabel = document.createElement('p');
            pageLabel.textContent = `Page ${p}`;
            pageLabel.style.textAlign = 'center';
            pageDiv.appendChild(pageLabel);
            container.appendChild(pageDiv);

            const page = await pdfDoc.getPage(p);
            const viewport = page.getViewport({ scale });
            const pageCtx = pageCanvas.getContext('2d');
            pageCanvas.height = viewport.height;
            pageCanvas.width = viewport.width;
            await page.render({ canvasContext: pageCtx, viewport }).promise;
            console.log(`Rendered canvas page ${p}`);
        }
        container.querySelector('#loading').remove();
    } catch (error) {
        console.error('Rendering error:', error);
        container.innerHTML = '<p>Rendering failed. Check console (F12).</p>';
    }
}

// Navigate to a specific page
function goToPage(pageNum) {
    if (pageNum < 1 || pageNum > pdfDoc.numPages) return;
    currentPage = pageNum;
    const pageEl = document.getElementById(`page-${pageNum}`);
    if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth' });
        console.log(`Navigated to page ${pageNum}`);
    }
    updatePageControls();
}

// Update navigation controls (Previous/Next buttons and page info)
function updatePageControls() {
    if (pdfDoc) {
        pageInfo.textContent = `Page ${currentPage} of ${pdfDoc.numPages}`;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= pdfDoc.numPages;
    }
}

// Build sidebar menu from PDF outline or generated TOC
async function buildMenu(filename) {
    let outline = await pdfDoc.getOutline();
    if (outline && outline.length > 0) {
        menuDiv.innerHTML = '';
        const ul = document.createElement('ul');
        await buildOutlineRecursive(ul, outline);
        menuDiv.appendChild(ul);
        console.log('Built menu from PDF outline');
        return;
    }

    await buildGeneralTocMenu();
}

// Generate TOC from page 4 if no outline exists
async function buildGeneralTocMenu() {
    if (!pdfDoc || pdfDoc.numPages < 5) {
        menuDiv.innerHTML = '<p>PDF too short for TOC.</p>';
        console.log('PDF too short for TOC');
        return;
    }

    try {
        const tocPage = await pdfDoc.getPage(4);
        const textContent = await tocPage.getTextContent();
        if (textContent.items.length > 0) {
            const lines = extractLinesFromText(textContent);
            const tocEntries = parseTocLines(lines);
            let offset = 0;
            if (tocEntries.length > 0 && tocEntries[0].page === 1) offset = 4;
            tocEntries.forEach(entry => entry.page += offset);
            const menuStructure = buildTocStructure(tocEntries);
            renderMenu(menuStructure);
            console.log('Built TOC menu from page 4');
        } else {
            menuDiv.innerHTML = '<p>No TOC found. Use page controls.</p>';
            console.log('No TOC found on page 4');
        }
    } catch (error) {
        console.error('TOC error:', error);
        menuDiv.innerHTML = '<p>Could not extract TOC.</p>';
    }
}

// Extract text lines from a page for TOC parsing
function extractLinesFromText(textContent) {
    if (textContent.items.length === 0) return [];
    const items = textContent.items.sort((a, b) => b.transform[5] - a.transform[5]);
    const lines = [];
    let currentLine = [];
    let lastY = null;
    const tolerance = 5;
    for (const item of items) {
        const y = Math.round(item.transform[5]);
        if (lastY === null || Math.abs(y - lastY) < tolerance) {
            currentLine.push(item.str.trim());
        } else {
            if (currentLine.length > 0) lines.push(currentLine.join(' ').trim());
            currentLine = [item.str.trim()];
        }
        lastY = y;
    }
    if (currentLine.length > 0) lines.push(currentLine.join(' ').trim());
    return lines;
}

// Parse TOC lines into title-page pairs
function parseTocLines(lines) {
    const entries = [];
    const pageRegex = /\s*(\d{1,3})\s*$/;
    for (const line of lines) {
        const pageMatch = line.match(pageRegex);
        if (pageMatch) {
            let title = line.replace(pageRegex, '').trim();
            const pageNum = parseInt(pageMatch[1]);
            if (pageNum === 0) continue;
            title = title.replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim();
            title = title.replace(/lV/g, 'IV').replace(/1V/g, 'IV').replace(/Vl/g, 'vi').replace(/l\sV/g, 'I V');
            if (title.length > 2) {
                entries.push({ title, page: pageNum });
            }
        }
    }
    entries.sort((a, b) => a.page - b.page);
    return entries;
}

// Build hierarchical TOC structure
function buildTocStructure(entries) {
    if (entries.length === 0) return [];
    const structure = [];
    let currentSection = null;
    for (const entry of entries) {
        const titleLower = entry.title.toLowerCase();
        const isSection = titleLower.includes('chapter') || titleLower.includes('section') || titleLower.includes('progressions') || titleLower.includes('about the book') || (currentSection && entry.page > currentSection.page + 5);
        if (isSection || !currentSection) {
            currentSection = { title: entry.title, page: entry.page, keys: [] };
            structure.push(currentSection);
        } else {
            currentSection.keys.push({ title: entry.title, page: entry.page });
        }
    }
    return structure;
}

// Render TOC menu in sidebar
function renderMenu(structure) {
    menuDiv.innerHTML = '';
    const ul = document.createElement('ul');
    structure.forEach(section => {
        const sectionLi = document.createElement('li');
        const sectionA = document.createElement('a');
        sectionA.textContent = section.title;
        sectionA.href = '#';
        sectionA.addEventListener('click', (e) => {
            e.preventDefault();
            goToPage(section.page);
        });
        sectionLi.appendChild(sectionA);

        if (section.keys && section.keys.length > 0) {
            const subUl = document.createElement('ul');
            section.keys.forEach(keyItem => {
                const keyLi = document.createElement('li');
                const keyA = document.createElement('a');
                keyA.textContent = keyItem.title;
                keyA.href = '#';
                keyA.addEventListener('click', (e) => {
                    e.preventDefault();
                    goToPage(keyItem.page);
                });
                keyLi.appendChild(keyA);
                subUl.appendChild(keyLi);
            });
            sectionLi.appendChild(subUl);
        }

        ul.appendChild(sectionLi);
    });
    menuDiv.appendChild(ul);
}

// Recursively build menu from PDF outline
async function buildOutlineRecursive(parentUl, items) {
    for (const item of items) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.textContent = item.title;
        a.href = '#';

        let pageNum = null;
        if (item.dest) {
            try {
                const pageRef = item.dest[0];
                if (pageRef && typeof pageRef === 'object' && pageRef.num !== undefined) {
                    const pageIndex = await pdfDoc.getPageIndex(pageRef);
                    pageNum = pageIndex + 1;
                }
            } catch (e) {
                console.warn('Page index error:', e);
            }
        }

        if (pageNum) {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                goToPage(pageNum);
            });
        } else {
            a.style.opacity = 0.5;
        }

        li.appendChild(a);
        parentUl.appendChild(li);

        if (item.items && item.items.length > 0) {
            const subUl = document.createElement('ul');
            await buildOutlineRecursive(subUl, item.items);
            li.appendChild(subUl);
        }
    }
}