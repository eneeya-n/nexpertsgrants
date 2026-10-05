(function () {
  var loginPanel = document.getElementById("login-panel");
  var createPanel = document.getElementById("create-panel");
  var dashboard = document.getElementById("dashboard");
  var loginForm = document.getElementById("login-form");
  var signupForm = document.getElementById("signup-form");
  var loginError = document.getElementById("login-error");
  var signupError = document.getElementById("signup-error");
  var loginBtn = document.getElementById("login-btn");
  var signupBtn = document.getElementById("signup-btn");
  var dashError = document.getElementById("dash-error");
  var dashList = document.getElementById("dash-list");
  var title = document.getElementById("marketer-title");
  var shareLink = document.getElementById("share-link");
  var copyNote = document.getElementById("copy-note");

  Array.prototype.forEach.call(document.querySelectorAll(".password-toggle"), function (button) {
    var input = document.getElementById(button.getAttribute("data-toggle") || "password");
    button.addEventListener("click", function () {
      var hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      button.textContent = hidden ? "Hide" : "Show";
      button.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
    });
  });

  document.getElementById("show-create").addEventListener("click", function (event) {
    event.preventDefault();
    showCreate();
  });
  document.getElementById("show-login").addEventListener("click", function (event) {
    event.preventDefault();
    showLogin();
  });

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    show(loginError, "");
    setBusy(loginBtn, true, "Signing in…", "Sign in");
    post("/api/marketer/login", {
      code: document.getElementById("code").value,
      password: document.getElementById("password").value,
    }).then(function (result) {
      if (!result.ok) {
        show(loginError, (result.body && result.body.error) || "The code or password is not correct.");
        return;
      }
      document.getElementById("password").value = "";
      return loadDashboard();
    }).catch(function () {
      show(loginError, "Sign-in could not be completed. Please try again.");
    }).then(function () {
      setBusy(loginBtn, false, "Signing in…", "Sign in");
    });
  });

  signupForm.addEventListener("submit", function (event) {
    event.preventDefault();
    show(signupError, "");
    var password = document.getElementById("signup-password").value;
    var confirm = document.getElementById("signup-confirm").value;
    if (password !== confirm) {
      show(signupError, "The passwords do not match.");
      return;
    }
    setBusy(signupBtn, true, "Creating account…", "Create account");
    post("/api/marketer/signup", {
      name: document.getElementById("signup-name").value,
      email: document.getElementById("signup-email").value,
      password: password,
      confirm: confirm,
      companyFax: document.getElementById("signup-fax").value,
    }).then(function (result) {
      if (!result.ok) {
        show(signupError, (result.body && result.body.error) || "Account creation could not be completed. Please try again.");
        return;
      }
      signupForm.reset();
      return loadDashboard();
    }).catch(function () {
      show(signupError, "Account creation could not be completed. Please try again.");
    }).then(function () {
      setBusy(signupBtn, false, "Creating account…", "Create account");
    });
  });

  document.getElementById("logout-btn").addEventListener("click", function () {
    fetch("/api/marketer/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
      dashboard.hidden = true;
      shareLink.value = "";
      dashList.textContent = "";
      showLogin();
    });
  });

  document.getElementById("copy-link").addEventListener("click", function () {
    var value = shareLink.value;
    if (!value) return;
    var done = function () {
      copyNote.hidden = false;
      window.setTimeout(function () { copyNote.hidden = true; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () {
        shareLink.focus();
        shareLink.select();
      });
      return;
    }
    shareLink.focus();
    shareLink.select();
  });

  loadDashboard().then(function (signedIn) {
    if (!signedIn && window.location.hash === "#create") showCreate();
  });

  function loadDashboard() {
    return fetch("/api/marketer/registrations", { credentials: "same-origin" }).then(function (response) {
      if (response.status === 401) return null;
      return response.json().then(function (body) {
        return { ok: response.ok, body: body };
      });
    }).then(function (result) {
      if (!result || !result.body || !result.body.name) return false;
      loginPanel.hidden = true;
      createPanel.hidden = true;
      dashboard.hidden = false;
      title.textContent = "Your dashboard";
      document.getElementById("dash-name").textContent = result.body.name || "";
      shareLink.value = result.body.link || "";
      var rows = result.body.rows || [];
      var count = rows.length;
      document.getElementById("dash-total").textContent = String(count);
      document.getElementById("dash-count").textContent = count === 1 ? "1 person registered with your link." : count + " people registered with your link.";
      show(dashError, result.body.listError || "");
      renderRows(rows);
      return true;
    }).catch(function () {
      if (!dashboard.hidden) show(dashError, "The registration list is not available right now.");
      return false;
    });
  }

  function renderRows(rows) {
    dashList.textContent = "";
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "reg-empty";
      empty.textContent = "No one has registered with your link yet.";
      dashList.appendChild(empty);
      return;
    }
    var table = document.createElement("table");
    table.className = "reg-table";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Name", "Date", "Serial No", "Application Status", "Payment Status", "Commission Status"].forEach(function (label) {
      var cell = document.createElement("th");
      cell.textContent = label;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = document.createElement("tbody");
    rows.forEach(function (row, index) {
      var tr = document.createElement("tr");
      var serial = String(row.serialNo || "").trim() || String(rows.length - index);
      [
        ["Name", row.name],
        ["Date", row.submittedAt],
        ["Serial No", serial],
        ["Application Status", row.applicationStatus],
        ["Payment Status", row.paymentStatus],
        ["Commission Status", row.commissionStatus],
      ].forEach(function (pair) {
        var td = document.createElement("td");
        td.setAttribute("data-label", pair[0]);
        td.textContent = pair[1] || "";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    dashList.appendChild(table);
  }

  function showLogin() {
    createPanel.hidden = true;
    loginPanel.hidden = false;
    title.textContent = "Marketer sign in";
    if (window.history && window.history.replaceState) window.history.replaceState(null, "", window.location.pathname);
  }

  function showCreate() {
    loginPanel.hidden = true;
    createPanel.hidden = false;
    title.textContent = "Create a marketer account";
    if (window.history && window.history.replaceState) window.history.replaceState(null, "", window.location.pathname + "#create");
  }

  function post(url, payload) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        return { ok: response.ok, body: body };
      });
    });
  }

  function setBusy(button, busy, busyText, idleText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  }

  function show(node, message) {
    node.hidden = !message;
    node.textContent = message || "";
  }
})();
