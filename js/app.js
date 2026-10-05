(function () {
  var INTAKES = [
    { id: "nov-weekday", label: "23.11.2026 - 27.11.2026 (weekday)", pdfDate: "23.11.2026 - 27.11.2026 (weekday)" },
    { id: "nov-weekend", label: "28.11.2026 - 12.12.2026 (weekend)", pdfDate: "28.11.2026 - 12.12.2026 (weekend)" },
    { id: "dec-weekday", label: "07.12.2026 - 11.12.2026 (weekday)", pdfDate: "07.12.2026 - 11.12.2026 (weekday)" },
    { id: "dec-weekend", label: "05.12.2026 - 19.12.2026 (weekend)", pdfDate: "05.12.2026 - 19.12.2026 (weekend)" },
  ];

  var scheduleBody = document.getElementById("schedule-body");
  var intakeFields = document.getElementById("intake-fields");
  var form = document.getElementById("enrol-form");
  var errorBox = document.getElementById("form-error");
  var successBox = document.getElementById("form-success");
  var submitBtn = document.getElementById("download-btn");
  var applyPanel = document.getElementById("apply");

  function openApplication() {
    applyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function intakeById(id) {
    return INTAKES.filter(function (item) { return item.id === id; })[0];
  }

  function renderSchedule() {
    scheduleBody.innerHTML = INTAKES.map(function (item) {
      return (
        "<tr data-intake=\"" + item.id + "\" tabindex=\"0\">" +
          "<td data-label=\"Course\">CEH</td>" +
          "<td data-label=\"Programme\">EC-Council Certified Ethical Hacker</td>" +
          "<td data-label=\"Intake\">" + item.label + "</td>" +
          "<td data-label=\"Time\">9.00AM – 5.00PM</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderIntakes() {
    intakeFields.innerHTML = '<option value="">Choose an option</option>' + INTAKES.map(function (item) {
      return '<option value="' + item.id + '">' + item.label + "</option>";
    }).join("");
  }

  function selectIntake(id) {
    intakeFields.value = id || "";
    Array.prototype.forEach.call(scheduleBody.querySelectorAll("tr"), function (row) {
      row.classList.toggle("is-selected", row.getAttribute("data-intake") === id);
    });
  }

  function showError(message) {
    errorBox.hidden = !message;
    errorBox.textContent = message || "";
    if (message) successBox.hidden = true;
  }

  renderSchedule();
  renderIntakes();

  Array.prototype.forEach.call(document.querySelectorAll('a[href="#apply"]'), function (link) {
    link.addEventListener("click", function (event) {
      event.preventDefault();
      openApplication();
    });
  });

  scheduleBody.addEventListener("click", function (event) {
    var row = event.target.closest("tr");
    if (!row) return;
    selectIntake(row.getAttribute("data-intake"));
    openApplication();
  });

  scheduleBody.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest("tr");
    if (!row) return;
    event.preventDefault();
    selectIntake(row.getAttribute("data-intake"));
  });

  intakeFields.addEventListener("change", function () {
    selectIntake(intakeFields.value);
  });

  function field(id) {
    return document.getElementById(id).value.replace(/\s+/g, " ").trim();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    showError("");
    successBox.hidden = true;

    var name = field("full-name");
    var nric = document.getElementById("nric").value.replace(/[\s-]/g, "").trim();
    var email = field("email");
    var phone = document.getElementById("phone").value.replace(/[^\d]/g, "");
    var workStatus = field("work-status");
    var street = field("street");
    var street2 = field("street2");
    var city = field("city");
    var region = field("region");
    var postal = field("postal");
    var country = field("country");
    var consent = document.getElementById("consent").checked;
    var intake = intakeById(intakeFields.value);
    var address = [street, street2, postal + (city ? " " + city : ""), region, country].filter(function (part) {
      return part && part.trim();
    }).join(", ");

    if (!name) {
      showError("Enter your full name as per IC.");
      document.getElementById("full-name").focus();
      return;
    }
    if (!/^\d{12}$/.test(nric)) {
      showError("Enter your IC number as 12 digits, without dashes.");
      document.getElementById("nric").focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Enter a valid email address.");
      document.getElementById("email").focus();
      return;
    }
    if (phone.length < 8) {
      showError("Enter your phone number.");
      document.getElementById("phone").focus();
      return;
    }
    if (!workStatus) {
      showError("Choose your current working status.");
      document.getElementById("work-status").focus();
      return;
    }
    if (!street || !city || !region || !postal || !country) {
      showError("Complete your address.");
      document.getElementById(street ? (city ? (region ? (postal ? "country" : "postal") : "region") : "city") : "street").focus();
      return;
    }
    if (!intake) {
      showError("Choose a training schedule. That date is printed on your letter.");
      intakeFields.focus();
      return;
    }
    if (!consent) {
      showError("Confirm the consent and agreement before submitting.");
      document.getElementById("consent").focus();
      return;
    }

    setBusy(true);

    window.NexpertsLetter.buildOfferLetter({
      name: name,
      nric: nric,
      address: address,
      trainingDate: intake.pdfDate,
    }).then(function (filled) {
      var pdfBase64 = bytesToBase64(filled.bytes);
      // Save first, and include the PDF so the server can email immediately after the sheet write.
      return fetch(new URL("api/apply", window.location.href), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyFax: document.getElementById("company-fax").value,
          name: name,
          nric: nric,
          email: email,
          phone: phone,
          workStatus: workStatus,
          street: street,
          street2: street2,
          city: city,
          region: region,
          postal: postal,
          country: country,
          address: address,
          trainingDate: intake.label,
          letterDate: filled.letterDate,
          filename: filled.filename,
          pdfBase64: pdfBase64,
          ref: referralCode(),
        }),
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "Your registration could not be saved.");
          }

          var finish = function (emailed) {
            window.NexpertsLetter.downloadOfferLetter(filled);
            form.reset();
            selectIntake("");
            successBox.hidden = false;
            document.getElementById("success-email").textContent = email;
            document.getElementById("success-intake").textContent = intake.label;
            if (!emailed) {
              showError("Your registration was saved, but the email could not be sent. Use “Did not receive your letter?” below with your IC to resend.");
            }
            successBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
          };

          if (payload.emailed === true) {
            finish(true);
            return;
          }

          // Backup mail path if the main request saved but did not email.
          return sendMailWithRetry({
            name: name,
            nric: nric,
            email: email,
            filename: filled.filename,
            pdfBase64: pdfBase64,
          }, 3).then(function () {
            finish(true);
          }).catch(function () {
            finish(false);
          });
        });
      });
    }).catch(function (error) {
      showError(publicError(error));
    }).then(function () {
      setBusy(false);
    });
  });

  function sendMailWithRetry(body, attempts) {
    var tries = Math.max(1, attempts || 1);
    var chain = Promise.reject(new Error("start"));
    for (var i = 0; i < tries; i++) {
      chain = chain.catch(function () {
        return fetch(new URL("api/apply/mail", window.location.href), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (payload) {
            if (!response.ok || !payload.ok) {
              throw new Error(payload.error || "The letter could not be emailed.");
            }
            return payload;
          });
        });
      });
    }
    return chain;
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.classList.toggle("is-loading", busy);
    submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
    submitBtn.querySelector(".btn-label").textContent = busy ? "Saving & emailing your letter…" : "Submit Application!";
  }

  function referralCode() {
    return new URLSearchParams(window.location.search).get("ref") || "";
  }

  function publicError(error) {
    var message = error && error.message ? String(error.message) : "";
    if (!message || message === "Failed to fetch" || message.length > 180 || /[\r\n]/.test(message)) {
      return "The letter could not be emailed. Check your details and try again.";
    }
    return message;
  }

  function bytesToBase64(bytes) {
    var binary = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  var recoverForm = document.getElementById("recover-form");
  var recoverError = document.getElementById("recover-error");
  var recoverSuccess = document.getElementById("recover-success");
  var recoverResult = document.getElementById("recover-result");
  var recoverFindBtn = document.getElementById("recover-find-btn");
  var recoverDownloadBtn = document.getElementById("recover-download-btn");
  var recoverResendBtn = document.getElementById("recover-resend-btn");
  var recovered = null;

  function showRecoverError(message) {
    recoverError.hidden = !message;
    recoverError.textContent = message || "";
    if (message) recoverSuccess.hidden = true;
  }

  function showRecoverSuccess(message) {
    recoverSuccess.hidden = !message;
    recoverSuccess.textContent = message || "";
    if (message) recoverError.hidden = true;
  }

  function setRecoverBusy(button, busy, busyText, idleText) {
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
    button.setAttribute("aria-busy", busy ? "true" : "false");
    var label = button.querySelector(".btn-label");
    if (label) label.textContent = busy ? busyText : idleText;
    else button.textContent = busy ? busyText : idleText;
  }

  function fillRecoverResult(record) {
    document.getElementById("recover-name").textContent = record.name || "";
    document.getElementById("recover-email").textContent = record.email || "";
    document.getElementById("recover-training").textContent = record.trainingDate || "";
    document.getElementById("recover-address").textContent = record.address || "";
    recoverResult.hidden = false;
    recoverResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function buildRecoveredLetter() {
    if (!recovered) return Promise.reject(new Error("Find your registration first."));
    return window.NexpertsLetter.buildOfferLetter({
      name: recovered.name,
      nric: recovered.nric,
      address: recovered.address,
      trainingDate: recovered.trainingDate,
      letterDate: recovered.letterDate || undefined,
    });
  }

  recoverForm.addEventListener("submit", function (event) {
    event.preventDefault();
    showRecoverError("");
    showRecoverSuccess("");
    recoverResult.hidden = true;
    recovered = null;

    var nric = document.getElementById("recover-nric").value.replace(/[\s-]/g, "").trim();
    if (!/^\d{12}$/.test(nric)) {
      showRecoverError("Enter your IC number as 12 digits, without dashes.");
      document.getElementById("recover-nric").focus();
      return;
    }

    setRecoverBusy(recoverFindBtn, true, "Looking up…", "Find my registration");
    fetch(new URL("api/recover/lookup", window.location.href), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nric: nric,
        companyFax: document.getElementById("recover-fax").value,
      }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "We could not look up your registration.");
        }
        if (!payload.found || !payload.record) {
          throw new Error("No registration was found for this IC number. Please use the application form above.");
        }
        recovered = payload.record;
        fillRecoverResult(recovered);
      });
    }).catch(function (error) {
      showRecoverError(publicError(error));
    }).then(function () {
      setRecoverBusy(recoverFindBtn, false, "Looking up…", "Find my registration");
    });
  });

  recoverDownloadBtn.addEventListener("click", function () {
    showRecoverError("");
    showRecoverSuccess("");
    setRecoverBusy(recoverDownloadBtn, true, "Preparing PDF…", "Download PDF");
    recoverResendBtn.disabled = true;
    buildRecoveredLetter().then(function (filled) {
      window.NexpertsLetter.downloadOfferLetter(filled);
      showRecoverSuccess("Your letter is downloading now.");
    }).catch(function (error) {
      showRecoverError(publicError(error));
    }).then(function () {
      setRecoverBusy(recoverDownloadBtn, false, "Preparing PDF…", "Download PDF");
      recoverResendBtn.disabled = false;
    });
  });

  recoverResendBtn.addEventListener("click", function () {
    showRecoverError("");
    showRecoverSuccess("");
    setRecoverBusy(recoverResendBtn, true, "Sending email…", "Email letter again");
    recoverDownloadBtn.disabled = true;
    buildRecoveredLetter().then(function (filled) {
      return fetch(new URL("api/recover/resend", window.location.href), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nric: recovered.nric,
          filename: filled.filename,
          pdfBase64: bytesToBase64(filled.bytes),
          companyFax: document.getElementById("recover-fax").value,
        }),
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok || !payload.ok) {
            throw new Error(payload.error || "The letter could not be emailed.");
          }
          window.NexpertsLetter.downloadOfferLetter(filled);
          showRecoverSuccess("Your letter was emailed to " + (payload.email || recovered.email) + " and is downloading now.");
        });
      });
    }).catch(function (error) {
      showRecoverError(publicError(error));
    }).then(function () {
      setRecoverBusy(recoverResendBtn, false, "Sending email…", "Email letter again");
      recoverDownloadBtn.disabled = false;
    });
  });
})();
