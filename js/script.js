// Fallback to local PDF.js if CDN fails
let pdfjsLib;
try {
    pdfjsLib = await import('https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs';
} catch (e) {
    console.warn('CDN failed, using local PDF.js');
    pdfjsLib = await import('/js/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.mjs';
}

const APP_VERSION = '1.2.0'; // Version for display

let pdfDoc = null;
let currentPage = 1;
const scale = 2.0;
let fullHtmlMode = false;
let htmlMode = false;

const upload = document.getElementById('upload');
const menuDiv = document.getElementById('menu');
const viewer = document.getElementById('viewer');
const documentContainer = document.getElementById('documentContainer');
const versionDiv = document.getElementById('version');

if (versionDiv) versionDiv.textContent = `Version ${APP_VERSION}`;

upload.addEventListener('change', handleFileSelect);

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

    menuDiv.innerHTML = '<div id="loading">Loading PDF...</div>';
    documentContainer.innerHTML = '';

    const arrayBuffer = await file.arrayBuffer();
    try {
        console.log('Starting PDF load for:', file.name, 'size:', file.size);
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        loadingTask.onProgress = (progress) => {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            menuDiv.innerHTML = `<div id="loading">Loading PDF... ${percent}%</div>`;
            console.log(`Loading progress: ${percent}%`);
        };
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Loading timeout after 60s')), 60000));
        pdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
        console.log('PDF loaded:', pdfDoc.numPages, 'pages');

        currentPage = 1;
        // Reset controls
        const controls = document.getElementById('pageControls');
        controls.innerHTML = '<button id="prevBtn" disabled>Previous</button><span id="pageInfo">Page 0 of 0</span><button id="nextBtn" disabled>Next</button>';
        pageInfo = document.getElementById('pageInfo');
        prevBtn = document.getElementById('prevBtn');
        nextBtn = document.getElementById('nextBtn');
        prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
        nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
        updatePageControls();

        await convertPdfToHtml();
        await buildMenu(file.name);
    } catch (error) {
        console.error('PDF load error:', error);
        alert(`Error: ${error.message}. Check console (F12). Try re-downloading the PDF or using Chrome incognito.`);
        menuDiv.innerHTML = '<p>Error loading.</p>';
    }
}

async function convertPdfToHtml() {
    const container = document.getElementById('documentContainer');
    container.innerHTML = '<div id="loading">Converting PDF to HTML...</div>';

    try {
        const samplePage = await pdfDoc.getPage(1);
        const textContent = await samplePage.getTextContent();
        if (textContent.items.length > 10) {
            htmlMode = true;
            console.log('Text-selectable PDF. Converting to HTML.');
            for (let p = 1; p <= pdfDoc.numPages; p++) {
                const page = await pdfDoc.getPage(p);
                const textContent = await page.getTextContent();
                const pageDiv = document.createElement('div');
                pageDiv.id = `page-${p}`;
                pageDiv.className = 'page-div';
                pageDiv.innerHTML = `<h2>Page ${p}</h2><p>${textContent.items.map(item => item.str).join(' ')}</p>`;
                container.appendChild(pageDiv);
                console.log(`Converted page ${p} to HTML`);
            }
            container.querySelector('#loading').remove();
        } else {
            console.log('Image-based PDF. Using canvas mode.');
            fullHtmlMode = true;
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
        }
    } catch (error) {
        console.error('Conversion error:', error);
        container.innerHTML = '<p>Conversion failed. Using basic view.</p>';
    }
}

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

function updatePageControls() {
    if (pdfDoc) {
        pageInfo.textContent = `Page ${currentPage} of ${pdfDoc.numPages}`;
        prevBtn.disabled = currentPage <= 1;
        nextBtn.disabled = currentPage >= pdfDoc.numPages;
    }
}

async function buildMenu(filename) {
    let outline = await pdfDoc.getOutline();
    if (outline && outline.length > 0) {
        menuDiv.innerHTML = '';
        const ul = document.createElement('ul');
        await buildOutlineRecursive(ul, outline);
        menuDiv.appendChild(ul);
        return;
    }

    if (fullHtmlMode) {
        menuDiv.innerHTML = '<p>Menu disabled in canvas mode. Use scroll.</p>';
        return;
    }

    await buildGeneralTocMenu();
}

async function buildGeneralTocMenu() {
    if (!pdfDoc || pdfDoc.numPages < 5) {
        menuDiv.innerHTML = '<p>PDF too short for TOC.</p>';
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
        } else {
            menuDiv.innerHTML = '<p>No TOC found. Use page controls.</p>';
        }
    } catch (error) {
        console.error('TOC error:', error);
        menuDiv.innerHTML = '<p>Could not extract TOC.</p>';
    }
}

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