// PDF Navigator App Version: 1.2.3

// Import PDF.js worker for module compatibility
import * as pdfjsLib from 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.min.mjs';

// Set the worker source for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs';

// Initialize variables
let pdfDoc = null; // Holds the loaded PDF document
let currentPage = 1; // Tracks the current page
let scale = 1.0; // Default scale for rendering

// DOM elements
const uploadInput = document.getElementById('upload');
const menuDiv = document.getElementById('menu');
const documentContainer = document.getElementById('documentContainer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const versionDiv = document.getElementById('version');

// Set version display
versionDiv.textContent = 'Version: 1.2.3';

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

        // Render all pages
        await renderAllPages();

        // Extract and display TOC
        await displayTOC();

        // Update page controls
        updatePageControls();
    } catch (error) {
        console.error('Error loading PDF:', error);
        menuDiv.innerHTML = '<div id="no-pdf">Failed to load PDF. Try again.</div>';
    }
});

// Render all pages in the document
async function renderAllPages() {
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
    }
}

// Extract and display Table of Contents
async function displayTOC() {
    try {
        const outline = await pdfDoc.getOutline();
        if (!outline || outline.length === 0) {
            menuDiv.innerHTML = '<div id="no-pdf">No Table of Contents available.</div>';
            return;
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
    } catch (error) {
        console.error('Error extracting TOC:', error);
        menuDiv.innerHTML = '<div id="no-pdf">Error loading TOC.</div>';
    }
}

// Navigate to a destination (TOC link)
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