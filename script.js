let selectedFile = null;
let extractedText = '';
let pdf = null;
let totalPages = 0;

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

// Fast quality assessment - optimized for speed
function calculateTextScore(text, confidence) {
    const cleanText = text.trim();
    if (cleanText.length === 0) return 0;

    // Use regex counts for speed (single pass)
    const letterCount = (cleanText.match(/[a-zA-Z]/g) || []).length;
    const spaceCount = (cleanText.match(/\s/g) || []).length;
    const weirdCount = (cleanText.match(/[^\w\s.,;:!?()\-]/g) || []).length;
    const wordMatches = cleanText.match(/[a-zA-Z]{2,}/g) || [];

    const totalChars = cleanText.length;

    // Quick ratios
    const letterRatio = letterCount / totalChars;
    const weirdRatio = weirdCount / totalChars;
    const wordCount = wordMatches.length;

    // Fast scoring
    let score = Math.min(cleanText.length / 10, 20); // Base score

    if (letterRatio > 0.4) score += letterRatio * 50;
    if (spaceCount > totalChars * 0.08 && spaceCount < totalChars * 0.25) score += 15;

    score += (confidence || 0) * 0.4;
    score -= weirdRatio * 80;

    if (letterRatio < 0.3) score -= 30;
    if (wordCount > 5) score += 15;

    return Math.max(0, score);
}

// Optimized canvas rendering with caching
function createOptimizedCanvas(viewport) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    // Set canvas size
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Optimize canvas for speed
    context.imageSmoothingEnabled = false; // Faster rendering

    return { canvas, context };
}

// Smart rotation testing with early exit
async function processPage(pageNum) {
    console.log(`\n=== Processing Page ${pageNum} ===`);

    try {
        const page = await pdf.getPage(pageNum);
        const scale = parseFloat(ocrQualitySelect.value);

        let bestResult = null;
        let bestScore = -1;
        let bestRotation = 0;

        // Step 1: Always try 0° first (most common)
        showProgress(15 + (pageNum / totalPages) * 70, `🔍 Page ${pageNum}: Testing standard orientation...`);

        const result0 = await testRotation(page, 0, scale, pageNum);
        bestResult = result0.result;
        bestScore = result0.score;
        bestRotation = 0;

        console.log(`Page ${pageNum} at 0°: Score=${bestScore.toFixed(1)}`);

        // Step 2: If 0° is good enough, skip other rotations
        if (bestScore > 60) {
            console.log(`Page ${pageNum}: 0° rotation is good enough (score: ${bestScore.toFixed(1)}), skipping other tests`);
            return createPageResult(pageNum, bestResult, bestRotation, bestScore);
        }

        // Step 3: Test other rotations only if needed
        const rotationsToTest = [90, 270, 180]; // Order by most likely
        let testedCount = 1;

        for (const rotation of rotationsToTest) {
            testedCount++;
            showProgress(15 + (pageNum / totalPages) * 70,
                `🔄 Page ${pageNum}: Testing ${rotation}° rotation (${testedCount}/4)...`);

            const result = await testRotation(page, rotation, scale, pageNum);

            console.log(`Page ${pageNum} at ${rotation}°: Score=${result.score.toFixed(1)}`);

            if (result.score > bestScore) {
                bestResult = result.result;
                bestScore = result.score;
                bestRotation = rotation;
                console.log(`Page ${pageNum}: New best rotation ${rotation}° (score: ${result.score.toFixed(1)})`);

                // Early exit if we found excellent quality
                if (bestScore > 80) {
                    console.log(`Page ${pageNum}: Excellent quality found at ${rotation}°, stopping tests`);
                    break;
                }
            }
        }

        return createPageResult(pageNum, bestResult, bestRotation, bestScore);

    } catch (error) {
        console.error(`❌ Error on page ${pageNum}:`, error);
        return {
            pageNum,
            text: `⚠️ Error extracting text from page ${pageNum}: ${error.message}`,
            wasRotated: false,
            detectedRotation: 0,
            confidence: 0,
            qualityScore: 0
        };
    }
}

// Helper function to test a single rotation
async function testRotation(page, rotation, scale, pageNum) {
    const viewport = page.getViewport({ scale, rotation });
    const { canvas, context } = createOptimizedCanvas(viewport);

    // Render page
    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    const imageData = canvas.toDataURL('image/png');

    // OCR with minimal logging for speed
    const result = await Tesseract.recognize(imageData, 'eng', {
        logger: () => {} // Silent for speed
    });

    const score = calculateTextScore(result.data.text.trim(), result.data.confidence);

    return { result, score };
}

// Helper function to create consistent page results
function createPageResult(pageNum, ocrResult, rotation, score) {
    const finalText = ocrResult.data.text.trim();
    const wasRotated = rotation !== 0;

    console.log(`Page ${pageNum} FINAL: Best rotation ${rotation}°, Score=${score.toFixed(1)}, Length=${finalText.length}`);

    return {
        pageNum,
        text: finalText,
        wasRotated: wasRotated,
        detectedRotation: rotation,
        confidence: ocrResult.data.confidence || 0,
        qualityScore: score
    };
}

// Batch processing with concurrency control
async function processPagesInParallel(pageNumbers, maxConcurrency = 2) {
    const results = [];

    for (let i = 0; i < pageNumbers.length; i += maxConcurrency) {
        const batch = pageNumbers.slice(i, i + maxConcurrency);

        showProgress(15 + (i / pageNumbers.length) * 70,
            `⚡ Processing pages ${batch.join(', ')} in parallel...`);

        const batchPromises = batch.map(pageNum => processPage(pageNum));
        const batchResults = await Promise.all(batchPromises);

        results.push(...batchResults);
    }

    return results;
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
        pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        showProgress(15, '📊 Analyzing document structure...');

        totalPages = pdf.numPages;
        let allText = `📄 EXTRACTED TEXT FROM: ${selectedFile.name}\n`;
        allText += `📅 Processed on: ${new Date().toLocaleString()}\n`;
        allText += `📑 Total Pages: ${totalPages}\n`;
        allText += `⚡ Smart Auto-rotation: Enabled (early exit optimization)\n`;
        allText += `${'='.repeat(60)}\n\n`;

        // Process pages with smart concurrency
        const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
        const results = await processPagesInParallel(pageNumbers, 2); // 2 pages at once

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
            return;
        }

        // Generate full extracted text
        results.sort((a, b) => a.pageNum - b.pageNum);

        // Count rotated pages for summary
        const rotatedPages = results.filter(r => r.wasRotated);

        if (rotatedPages.length > 0) {
            allText += `🔄 Auto-rotated ${rotatedPages.length} page(s): ${rotatedPages.map(r => `Page ${r.pageNum} (${r.detectedRotation}°)`).join(', ')}\n\n`;
        }

        for (const r of results) {
            allText += `📄 PAGE ${r.pageNum}${r.wasRotated ? ` (Auto-rotated to ${r.detectedRotation}°)` : ''}\n`;
            allText += `🎯 Confidence: ${r.confidence}% | Quality Score: ${Math.round(r.qualityScore)}\n`;
            allText += `-`.repeat(50) + '\n';
            allText += r.text + '\n\n';
        }

        extractedText = allText;
        showProgress(100, '🎉 Text extraction completed!');

        setTimeout(() => {
            progressSection.style.display = 'none';
            downloadBtn.style.display = 'inline-block';
            resetBtn.style.display = 'inline-block';

            let statusMessage = `🎉 Successfully extracted text from ${totalPages} page(s) with smart auto-rotation!`;
            if (rotatedPages.length > 0) {
                statusMessage += ` (Rotated ${rotatedPages.length} page${rotatedPages.length > 1 ? 's' : ''})`;
            }
            statusMessage += ' Click download to save your file.';

            showStatus(statusMessage, 'success');
        }, 1000);

    } catch (error) {
        console.error('Error:', error);
        showStatus('❌ Error extracting text: ' + error.message, 'error');
        progressSection.style.display = 'none';
    } finally {
        extractBtn.disabled = false;
    }
}
