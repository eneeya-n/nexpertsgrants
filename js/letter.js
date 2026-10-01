/**
 * Fills the original Nexperts CEH enrolment letter.
 * Name, NRIC, address, letter date, and training date change.
 * Letterhead, wording, and Nazreen Abdul Ghani's signature stay as in the original.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.NexpertsLetter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function formatLetterDate(date) {
    const d = date instanceof Date ? date : new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return dd + "." + mm + "." + yyyy;
  }

  function pdfText(value) {
    return String(value || "")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  function cover(page, rgb, x, y, w, h) {
    page.drawRectangle({ x: x, y: y, width: w, height: h, color: rgb(1, 1, 1), borderWidth: 0 });
  }

  function fitText(page, font, rgb, text, x, y, maxWidth) {
    var size = 11;
    var value = pdfText(text);
    while (size > 7.5 && font.widthOfTextAtSize(value, size) > maxWidth) size -= 0.25;
    page.drawText(value, { x: x, y: y, size: size, font: font, color: rgb(0, 0, 0) });
  }

  function drawWrapped(page, font, rgb, text, x, y, maxWidth, leading) {
    var words = pdfText(text).split(" ");
    var line = "";
    var cursor = y;
    words.forEach(function (word) {
      var trial = line ? line + " " + word : word;
      if (line && font.widthOfTextAtSize(trial, 11) > maxWidth) {
        page.drawText(line, { x: x, y: cursor, size: 11, font: font, color: rgb(0, 0, 0) });
        cursor -= leading;
        line = word;
      } else {
        line = trial;
      }
    });
    if (line) {
      page.drawText(line, { x: x, y: cursor, size: 11, font: font, color: rgb(0, 0, 0) });
      cursor -= leading;
    }
    return cursor;
  }

  async function fillTemplate(pdfLib, templateBytes, data) {
    const PDFDocument = pdfLib.PDFDocument;
    const StandardFonts = pdfLib.StandardFonts;
    const rgb = pdfLib.rgb;
    const pdf = await PDFDocument.load(templateBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const name = pdfText(data.name);
    const nric = pdfText(data.nric);
    const address = pdfText(data.address);
    const trainingDate = pdfText(data.trainingDate);
    const letterDate = pdfText(data.letterDate || formatLetterDate(new Date()));
    const pages = pdf.getPages();
    const offer = pages[0];
    const acceptance = pages[3];

    cover(offer, rgb, 100, 610, 90, 12);
    cover(offer, rgb, 136, 562.1, 398, 11);
    cover(offer, rgb, 136, 549.0, 398, 10.4);
    cover(offer, rgb, 136, 535.7, 398, 10.5);
    cover(offer, rgb, 210, 303.2, 320, 10.2);
    fitText(offer, font, rgb, letterDate, 101.5, 615, 110);
    fitText(offer, font, rgb, name, 135.9, 563.5, 400);
    fitText(offer, font, rgb, nric, 135.9, 550.3, 200);
    fitText(offer, font, rgb, address, 135.9, 537.1, 410);
    fitText(offer, font, rgb, trainingDate, 207.9, 304.4, 210);

    cover(acceptance, rgb, 100, 610, 100, 12);
    cover(acceptance, rgb, 136, 562.3, 398, 10.8);
    cover(acceptance, rgb, 136, 549.1, 398, 10.4);
    cover(acceptance, rgb, 136, 535.8, 398, 10.5);
    cover(acceptance, rgb, 68, 308, 490, 152);
    fitText(acceptance, font, rgb, ": " + letterDate, 95.3, 615.1, 130);
    fitText(acceptance, font, rgb, name, 135.9, 563.6, 400);
    fitText(acceptance, font, rgb, nric, 135.9, 550.4, 200);
    fitText(acceptance, font, rgb, address, 135.9, 537.1, 410);

    var cursor = drawWrapped(
      acceptance,
      font,
      rgb,
      "I, [" + name + "], NRIC No: [" + nric + "], hereby accept the offer of enrolment into the EC-Council Certified Ethical Hacker (CEH) training programme conducted by Nexperts Academy Sdn Bhd, with financial assistance provided by Yayasan Peneraju.",
      72,
      446.5,
      468,
      12.6
    );
    drawWrapped(
      acceptance,
      font,
      rgb,
      "I acknowledge that I have read, understood, and agree to all the terms and conditions outlined in the Offer Letter dated [" + letterDate + "], and agree to comply fully with the requirements set forth therein.",
      72,
      cursor - 12.6,
      468,
      12.6
    );

    const safeName = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    pdf.setTitle("Letter of Enrolment CEH " + safeName);
    pdf.setAuthor("Nexperts Academy Sdn Bhd");
    return {
      bytes: await pdf.save(),
      filename: "Letter of Enrolment CEH " + safeName + ".pdf",
    };
  }

  async function generateOfferLetter(data) {
    const response = await fetch("assets/letter-template.pdf");
    if (!response.ok) throw new Error("Template missing");
    const templateBytes = await response.arrayBuffer();
    const pdfLib = globalThis.PDFLib;
    if (!pdfLib) throw new Error("PDF library did not load");
    const filled = await fillTemplate(pdfLib, templateBytes, data);
    const blob = new Blob([filled.bytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filled.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    return filled;
  }

  return {
    formatLetterDate: formatLetterDate,
    fillTemplate: fillTemplate,
    generateOfferLetter: generateOfferLetter,
  };
});
