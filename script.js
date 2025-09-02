document.getElementById("extractBtn").addEventListener("click", async () => {
  const fileInput = document.getElementById("pdfFile");
  const keywordsInput = document.getElementById("keywords");
  const quality = document.getElementById("ocrQuality").value;
  const outputDiv = document.getElementById("output");
  outputDiv.innerHTML = "<p>Processing... Please wait.</p>";

  if (fileInput.files.length === 0) {
    alert("Please upload a PDF file.");
    return;
  }

  const file = fileInput.files[0];
  const fileReader = new FileReader();

  fileReader.onload = async function () {
    const typedarray = new Uint8Array(this.result);
    const pdf = await pdfjsLib.getDocument(typedarray).promise;

    let extractedText = "";
    let keywordResults = [];
    const keywords = keywordsInput.value
      ? keywordsInput.value.split(",").map(k => k.trim().toLowerCase())
      : [];

    // Decide OCR resolution
    let dpi;
    if (quality === "low") dpi = 72;
    else if (quality === "medium") dpi = 150;
    else dpi = 300;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      // Convert to grayscale
      const imgData = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const avg = (imgData.data[i] + imgData.data[i + 1] + imgData.data[i + 2]) / 3;
        imgData.data[i] = avg;
        imgData.data[i + 1] = avg;
        imgData.data[i + 2] = avg;
      }
      context.putImageData(imgData, 0, 0);
      const grayscaleImage = canvas.toDataURL("image/png");

      // OCR with optimized config
      const { data: { text } } = await Tesseract.recognize(grayscaleImage, 'eng', {
        tessedit_pageseg_mode: 6
      });

      extractedText += `\n--- Page ${pageNum} ---\n${text}\n`;

      // Keyword search
      if (keywords.length > 0) {
        const lowerText = text.toLowerCase();
        for (const keyword of keywords) {
          if (lowerText.includes(keyword)) {
            keywordResults.push({
              keyword,
              page: pageNum,
              context: text.substring(0, 300).replace(/\s+/g, " ") + "..."
            });
          }
        }
      }
    }

    // Display results in UI
    let html = "<h2>Extracted Text</h2>";
    html += `<pre>${extractedText}</pre>`;

    if (keywords.length > 0) {
      html += "<h2>Keyword Matches</h2>";
      if (keywordResults.length > 0) {
        html += "<table border='1' style='border-collapse: collapse; width: 100%; text-align: left;'>";
        html += "<tr><th style='white-space: nowrap;'>Keyword</th><th style='white-space: nowrap;'>Page</th><th>Context</th></tr>";
        keywordResults.forEach(result => {
          html += `<tr><td>${result.keyword}</td><td>${result.page}</td><td>${result.context}</td></tr>`;
        });
        html += "</table>";
      } else {
        html += "<p>No keywords found.</p>";
      }
    }

    outputDiv.innerHTML = html;
  };

  fileReader.readAsArrayBuffer(file);
});
