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

  function writeLine(page, font, rgb, text, x, y) {
    page.drawText(pdfText(text), { x: x, y: y, size: 11, font: font, color: rgb(0, 0, 0) });
  }

  function fitText(page, font, rgb, text, x, y, maxWidth) {
    var size = 11;
    var value = pdfText(text);
    while (size > 7.5 && font.widthOfTextAtSize(value, size) > maxWidth) size -= 0.25;
    page.drawText(value, { x: x, y: y, size: size, font: font, color: rgb(0, 0, 0) });
  }

  var ADDRESS_SIZE = 11;
  var ADDRESS_X = 135.9;
  var ADDRESS_BASELINE = 537.1;
  var ADDRESS_WIDTH = 396;

  function wrapLines(font, text, maxWidth, size) {
    var words = pdfText(text).split(" ").filter(function (word) { return word; });
    var lines = [];
    var line = "";
    function addWord(word) {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (line) lines.push(line);
        var chunk = "";
        for (var i = 0; i < word.length; i++) {
          var next = chunk + word.charAt(i);
          if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
            lines.push(chunk);
            chunk = word.charAt(i);
          } else {
            chunk = next;
          }
        }
        line = chunk;
        return;
      }
      var trial = line ? line + " " + word : word;
      if (line && font.widthOfTextAtSize(trial, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    words.forEach(addWord);
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function drawWrapped(page, font, rgb, text, x, y, maxWidth, leading) {
    var lines = wrapLines(font, text, maxWidth, ADDRESS_SIZE);
    var cursor = y;
    lines.forEach(function (line) {
      page.drawText(line, { x: x, y: cursor, size: ADDRESS_SIZE, font: font, color: rgb(0, 0, 0) });
      cursor -= leading;
    });
    return cursor;
  }

  async function growAddressRow(pdf, pdfLib, page, cellBottom, extra) {
    if (extra <= 0) return;
    var index = pdf.getPages().indexOf(page);
    var donorDoc = await pdfLib.PDFDocument.create();
    var donorPages = await donorDoc.copyPages(pdf, [index]);
    var embedded = await pdf.embedPage(donorPages[0]);
    var width = page.getWidth();
    var height = page.getHeight();
    var media = page.getMediaBox();
    page.setMediaBox(media.x, media.y - extra, media.width, media.height + extra);
    page.drawRectangle({
      x: media.x,
      y: media.y - extra,
      width: width,
      height: height + extra,
      color: pdfLib.rgb(1, 1, 1),
    });

    function clipped(y, h, drawY) {
      page.pushOperators(
        pdfLib.pushGraphicsState(),
        pdfLib.rectangle(0, y, width, h),
        pdfLib.clip(),
        pdfLib.endPath()
      );
      page.drawPage(embedded, { x: 0, y: drawY });
      page.pushOperators(pdfLib.popGraphicsState());
    }

    clipped(cellBottom, height - cellBottom, 0);
    clipped(media.y - extra, cellBottom - media.y, -extra);
  }

  function drawAddress(page, font, rgb, address, row) {
    var lines = wrapLines(font, address, ADDRESS_WIDTH, ADDRESS_SIZE);
    var extra = Math.max(0, lines.length - 1) * row.leading;
    var interiorBottom = row.cellBottom - extra;
    cover(page, rgb, 131.2, interiorBottom + 0.7, 407.8, row.cellTop - (interiorBottom + 0.7));
    if (extra > 0) {
      cover(page, rgb, 73.2, interiorBottom + 0.8, 56.8, extra - 1.1);
    }
    [72.5, 130.82, 539.61].forEach(function (x) {
      page.drawLine({
        start: { x: x, y: interiorBottom },
        end: { x: x, y: row.cellTop },
        thickness: 0.7,
        color: rgb(0, 0, 0),
      });
    });
    lines.forEach(function (line, index) {
      page.drawText(line, {
        x: ADDRESS_X,
        y: ADDRESS_BASELINE - index * row.leading,
        size: ADDRESS_SIZE,
        font: font,
        color: rgb(0, 0, 0),
      });
    });
    return extra;
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
    const offerRow = { cellBottom: 534.67, cellTop: 547.53, leading: 12.86 };
    const acceptanceRow = { cellBottom: 534.79, cellTop: 547.53, leading: 12.74 };
    const addressLines = wrapLines(font, address, ADDRESS_WIDTH, ADDRESS_SIZE);
    const offerExtra = Math.max(0, addressLines.length - 1) * offerRow.leading;
    const acceptanceExtra = Math.max(0, addressLines.length - 1) * acceptanceRow.leading;
    await growAddressRow(pdf, pdfLib, offer, offerRow.cellBottom, offerExtra);
    await growAddressRow(pdf, pdfLib, acceptance, acceptanceRow.cellBottom, acceptanceExtra);

    cover(offer, rgb, 100, 610, 90, 12);
    cover(offer, rgb, 136, 562.1, 398, 11);
    cover(offer, rgb, 136, 549.0, 398, 10.4);
    cover(offer, rgb, 210, 303.2 - offerExtra, 325, 10.2);
    cover(offer, rgb, 206, 314.9 - offerExtra, 120, 12);
    cover(offer, rgb, 88, 134.1 - offerExtra, 430, 12.4);
    fitText(offer, font, rgb, letterDate, 101.5, 615, 110);
    fitText(offer, font, rgb, name, 135.9, 563.5, 400);
    fitText(offer, font, rgb, nric, 135.9, 550.3, 200);
    drawAddress(offer, font, rgb, address, offerRow);
    writeLine(offer, font, rgb, trainingDate, 207.9, 304.4 - offerExtra);
    writeLine(offer, font, rgb, "Full Online", 207.9, 317.7 - offerExtra);
    writeLine(offer, font, rgb, "6. Allowance of RM 500 provided by Nexperts Academy", 90, 136.8 - offerExtra);

    cover(acceptance, rgb, 100, 610, 100, 12);
    cover(acceptance, rgb, 136, 562.3, 398, 10.8);
    cover(acceptance, rgb, 136, 549.1, 398, 10.4);
    cover(acceptance, rgb, 68, 308 - acceptanceExtra, 490, 152);
    fitText(acceptance, font, rgb, ": " + letterDate, 95.3, 615.1, 130);
    fitText(acceptance, font, rgb, name, 135.9, 563.6, 400);
    fitText(acceptance, font, rgb, nric, 135.9, 550.4, 200);
    drawAddress(acceptance, font, rgb, address, acceptanceRow);

    var cursor = drawWrapped(
      acceptance,
      font,
      rgb,
      "I, [" + name + "], NRIC No: [" + nric + "], hereby accept the offer of enrolment into the EC-Council Certified Ethical Hacker (CEH) training programme conducted by Nexperts Academy Sdn Bhd, with financial assistance provided by Yayasan Peneraju.",
      72,
      446.5 - acceptanceExtra,
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
      letterDate: letterDate,
    };
  }

  async function buildOfferLetter(data) {
    const response = await fetch("assets/letter-template.pdf");
    if (!response.ok) throw new Error("Template missing");
    const templateBytes = await response.arrayBuffer();
    const pdfLib = globalThis.PDFLib;
    if (!pdfLib) throw new Error("PDF library did not load");
    return fillTemplate(pdfLib, templateBytes, data);
  }

  function downloadOfferLetter(filled) {
    const blob = new Blob([filled.bytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filled.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  async function generateOfferLetter(data) {
    const filled = await buildOfferLetter(data);
    downloadOfferLetter(filled);
    return filled;
  }

  return {
    formatLetterDate: formatLetterDate,
    fillTemplate: fillTemplate,
    buildOfferLetter: buildOfferLetter,
    downloadOfferLetter: downloadOfferLetter,
    generateOfferLetter: generateOfferLetter,
  };
});
