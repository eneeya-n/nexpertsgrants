(function () {
  var INTAKES = [
    { id: "nov-weekday", range: "23/11 – 27/11", days: "Mon–Fri", pdfDate: "23.11.2026 – 27.11.2026" },
    { id: "nov-weekend", range: "28/11 – 12/12", days: "Weekends", pdfDate: "28.11.2026 – 12.12.2026" },
    { id: "dec-weekday", range: "7/12 – 11/12", days: "Mon–Fri", pdfDate: "07.12.2026 – 11.12.2026" },
    { id: "dec-weekend", range: "5/12 – 19/12", days: "Weekend", pdfDate: "05.12.2026 – 19.12.2026" },
  ];

  var scheduleBody = document.getElementById("schedule-body");
  var intakeFields = document.getElementById("intake-fields");
  var form = document.getElementById("enrol-form");
  var errorBox = document.getElementById("form-error");
  var successBox = document.getElementById("form-success");
  var submitBtn = document.getElementById("download-btn");
  var selectCehBtn = document.getElementById("select-ceh");
  var aimCeh = document.getElementById("aim-ceh");
  var applyPanel = document.getElementById("apply");

  function setFlow(step) {
    Array.prototype.forEach.call(document.querySelectorAll("#flow li"), function (li, index) {
      var n = index + 1;
      li.classList.toggle("is-done", n < step);
      li.classList.toggle("is-current", n === step);
      var kicker = li.querySelector(".flow-kicker");
      if (n < step) kicker.textContent = "Done";
      else if (n === step) kicker.textContent = "You are here";
      else kicker.textContent = "Next";
    });
  }

  function selectCeh() {
    document.body.classList.add("ceh-selected");
    selectCehBtn.classList.add("is-selected");
    selectCehBtn.setAttribute("aria-pressed", "true");
    selectCehBtn.querySelector(".pick-state").textContent = "Application open";
    aimCeh.hidden = true;
    applyPanel.hidden = false;
    if (!document.body.classList.contains("letter-ready")) setFlow(2);
  }

  function openApplication() {
    selectCeh();
    applyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function intakeById(id) {
    return INTAKES.filter(function (item) { return item.id === id; })[0];
  }

  function renderSchedule() {
    scheduleBody.innerHTML = INTAKES.map(function (item) {
      return (
        "<tr data-intake=\"" + item.id + "\" tabindex=\"0\">" +
          "<td>CEH</td>" +
          "<td>EC-Council Certified Ethical Hacker</td>" +
          "<td>" + item.range + "</td>" +
          "<td>" + item.days + "</td>" +
          "<td>9.00AM – 5.00PM</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderIntakes() {
    intakeFields.innerHTML = '<option value="">Choose an option</option>' + INTAKES.map(function (item) {
      return '<option value="' + item.id + '">' + item.range + " | " + item.days + "</option>";
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

  selectCehBtn.addEventListener("click", openApplication);
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

    submitBtn.disabled = true;
    submitBtn.textContent = "Preparing your letter…";

    window.NexpertsLetter.generateOfferLetter({
      name: name,
      nric: nric,
      address: address,
      trainingDate: intake.pdfDate,
    }).then(function () {
      document.body.classList.add("letter-ready");
      setFlow(3);
      successBox.hidden = false;
      document.getElementById("success-intake").textContent = intake.range + " | " + intake.days;
      submitBtn.textContent = "Download offer letter";
      successBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }).catch(function () {
      showError("The letter could not be created. Check your details and try again.");
      submitBtn.textContent = "Submit Application!";
    }).then(function () {
      submitBtn.disabled = false;
    });
  });
})();
