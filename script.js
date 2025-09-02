let selectedFile = null;
let extractedText = '';

const fileInput = document.getElementById('fileInput');
const extractBtn = document.getElementById('extractBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const progressSection = document.getElementById('progressSection');
const progressText = document.getElementById('progressText');
const progressBar = document.getElementById('progressBar');
const statusDiv = document.getElementById('status');
const ocrQualitySelect = document.getElementById('ocrQuality');
const modeSelect = document.getElementById('mode');
const keywordSection = document.getElementById('keywordSection');

// Toggle keyword section
modeSelect.addEventListener('change', () => {
    keywordSection.style.display = modeSelect.value === 'keywords' ? 'block' : 'none';
});

// Select file
fileInput.addEventListener('change', (e) => {
    selectedFile = e.target.files[0];
    if (selectedFile) {
        showStatus(`📂 Selected file: ${selectedFile.name}`, 'success');
    }
});

// Extract button
extractBtn.addEventListener('click', extractText);

// Download text
downloadBtn.addEventListener('click', () => {
    const blob = new Blob([extractedText], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = selectedFile.name.replace('.pdf', '_extracted.txt');
    link.click();
});

// Reset app
resetBtn.addEventListener('click', () => {
    selectedFile = null;
    extractedText = '';
    fileInput.value = '';
    progressSection.style.display = 'none';
    downloadBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    statusDiv.innerHTML = '';
});

// Show status
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = type;
}

// Show progress
function showProgress(percent, message) {
    progressText.textContent = message;
    progressBar.value = percent;
}

// Keyword search
function findKeywordsInText(results, keywords) {
    const matches = [];

    results.forEach(page => {
        const pageText = page.text.toLowerCase();

        keywords.forEach(keyword => {
            const lowerKeyword = keyword.toLowerCase();
            let index = pageText.indexOf(lowerKeyword);

            while (index !== -1) {
                const start = Math.max(0, index - 60);
                const end = Math.min(pageText.length, index + lowerKeyword.length + 60);
                const snippet = page.text.substring(start, end).replace(/\s+/g, ' ');

                matches.push({
                    keyword: keyword,
                    page: page.pageNum,
                    context: snippet
                });

                index = pageText.indexOf(lowerKeyword, index + lowerKeyword.length);
            }
        });
    });

    return matches;
}

// Main extraction logic
async function extractText() {
    if (!selectedFile) return;

    extractBtn.disabled = true;
    downloadBtn.style.display = 'none';
    resetBtn.style.display = 'none';
    progressSection.style.display = 'block';
    extractedText = '';

    try {
        showProgress(5, '📖 Loading PDF document...');

        const arrayBuffer = await selectedFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        showProgress(15, '📊 Analyzing document structure...');

        const totalPages = pdf.numPages;
        let allText = `📄 EXTRACTED TEXT FROM: ${selectedFile.name}\n`;
        allText += `📅 Processed on: ${new Date().toLocaleString()}\n`;
        allText += `📑 Total Pages: ${totalPages}\n`;
        allText += `${'='.repeat(60)}\n\n`;

        const scale = parseFloat(ocrQualitySelect.value);

        async function batchProcess(items, batchSize, processFn) {
            let results = [];
            for (let i = 0; i < items.length; i += batchSize) {
                showProgress(15 + (i / items.length) * 70,
                    `🔍 Processing pages ${i+1}-${Math.min(i+batchSize, items.length)} of ${items.length}...`);
                const batch = items.slice(i, i + batchSize);
                const batchResults = await Promise.all(batch.map(processFn));
                results = results.concat(batchResults);
            }
            return results;
        }

        async function processPage(pageNum) {
            try {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: context, viewport }).promise;

                const imageData = canvas.toDataURL('image/png');
                let lastProgress = 0;

                const result = await Tesseract.recognize(imageData, 'eng', {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            const ocrProgress = Math.round(m.progress * 100);
                            if (ocrProgress !== lastProgress) {
                                showProgress(15 + (pageNum / totalPages) * 70,
                                    `🤖 OCR processing page ${pageNum}... ${ocrProgress}%`);
                                lastProgress = ocrProgress;
                            }
                        }
                    }
                });

                return { pageNum, text: result.data.text.trim() };
            } catch (error) {
                console.error(`❌ Error on page ${pageNum}:`, error);
                return { pageNum, text: `⚠️ Error extracting text from page ${pageNum}` };
            }
        }

        const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
        const batchSize = 3;

        const results = await batchProcess(pageNumbers, batchSize, processPage);

        // Check mode
        if (modeSelect.value === 'keywords') {
            const keywordsInput = document.getElementById('keywords').value.trim();
            if (!keywordsInput) {
                showStatus('⚠️ Please enter keywords to search.', 'error');
                progressSection.style.display = 'none';
                extractBtn.disabled = false;
                return;
            }

            const keywords = keywordsInput.split(',').map(k => k.trim()).filter(k => k);
            const matches = findKeywordsInText(results, keywords);

            if (matches.length > 0) {
                let tableHtml = `
                    <table>
                        <tr>
                            <th>Keyword</th>
                            <th>Page</th>
                            <th>Context</th>
                        </tr>
                `;

                matches.forEach(m => {
                    tableHtml += `
                        <tr>
                            <td>${m.keyword}</td>
                            <td>${m.page}</td>
                            <td>${m.context}</td>
                        </tr>`;
                });

                tableHtml += `</table>`;
                statusDiv.innerHTML = `🔎 Found ${matches.length} matches:<br>` + tableHtml;
                statusDiv.className = 'success';
            } else {
                showStatus('⚠️ No matches found for given keywords.', 'error');
            }

            progressSection.style.display = 'none';
            resetBtn.style.display = 'inline-block';
            extractBtn.disabled = false;
            return; // stop here, no full-text output
        }

        // Otherwise → full extracted text
        results.sort((a, b) => a.pageNum - b.pageNum);
        for (const r of results) {
            allText += `📄 PAGE ${r.pageNum}\n`;
            allText += `-`.repeat(40) + '\n';
            allText += r.text + '\n\n';
        }

        extractedText = allText;
        showProgress(100, '🎉 Text extraction completed!');

        setTimeout(() => {
            progressSection.style.display = 'none';
            downloadBtn.style.display = 'inline-block';
            resetBtn.style.display = 'inline-block';
            showStatus(`🎉 Successfully extracted text from ${totalPages} page(s)! Click download to save your file.`, 'success');
        }, 1000);

    } catch (error) {
        console.error('Error:', error);
        showStatus('❌ Error extracting text: ' + error.message, 'error');
        progressSection.style.display = 'none';
    } finally {
        extractBtn.disabled = false;
    }
}
