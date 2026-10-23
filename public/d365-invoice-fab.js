/**
 * Dynamics 365 Floating Action Button (FAB) & Floating Drawer for Invoice & Quote AI Agent
 * - Single modern Floating Action Button (✨) at bottom-right (Emerald / Teal gradient)
 * - Click once -> Smoothly opens the AI Invoice Agent Floating Drawer
 * - Click again or click Close (✕) -> Closes the Drawer
 * - Works on BOTH Invoice and Quotation records & grids
 * - AUTO-CLEANUP on Page Navigation: Automatically removes button when moving away to other pages
 * - Passes active record context (Invoice ID, Quote ID, Customer Name, Total Amount)
 */

var topWin = (typeof window !== "undefined" && window.top) ? window.top : (typeof window !== "undefined" ? window : globalThis);
var InvoiceAIAgent = topWin.__InvoiceAIAgent || window.InvoiceAIAgent || {};
topWin.__InvoiceAIAgent = InvoiceAIAgent;
topWin.InvoiceAIAgent = InvoiceAIAgent;
if (typeof window !== "undefined") {
  window.InvoiceAIAgent = InvoiceAIAgent;
}

// Active Cloudflare Tunnel Live URL for Invoice AI Agent (Superfast Local Server)
InvoiceAIAgent.WIDGET_URL = "https://lung-urge-portsmouth-officially.trycloudflare.com/invoice";

InvoiceAIAgent.currentFormContext = null;
InvoiceAIAgent.watcherInterval = null;

/**
 * Dynamics 365 Form OnLoad / Ribbon Handler
 */
InvoiceAIAgent.onLoad = function (executionContext, selectedControl) {
  try {
    var isFormLoadEvent = executionContext && typeof executionContext.getFormContext === "function";

    if (isFormLoadEvent) {
      InvoiceAIAgent.currentFormContext = executionContext.getFormContext();
      // On form load, initialize floating button & watcher
      if (InvoiceAIAgent.isInvoiceActive()) {
        InvoiceAIAgent.initUI();
        InvoiceAIAgent.startNavigationWatcher();
      }
      return;
    }

    // 🎯 Any Ribbon Button click MUST open the Copilot-style Side Pane!
    return InvoiceAIAgent.openSidePane(executionContext, selectedControl);
  } catch (err) {
    console.error("Error in InvoiceAIAgent.onLoad:", err);
  }
};

InvoiceAIAgent.closeNativeSidePane = function () {
  try {
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (topWin && topWin.Xrm);
    if (xrm && xrm.App && xrm.App.sidePanes && xrm.App.sidePanes.getPane) {
      var pane = xrm.App.sidePanes.getPane("InvoiceAIAgentSidePane");
      if (pane && pane.close) pane.close();
    }
  } catch (e) { }
};

/**
 * Dynamically refresh the drawer iframe with current active Invoice context
 */
InvoiceAIAgent.refreshDrawerContext = function (forcedContext) {
  try {
    var targetDoc = topWin.document || document;
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    var frame = targetDoc.getElementById("d365-invoice-ai-frame");
    if (!drawer || !frame) return;

    var ctx = forcedContext || InvoiceAIAgent.getContext();
    var activeIdentifier = ctx.recordId || ctx.customerName || ctx.recordName || "";
    if (!activeIdentifier || activeIdentifier === "All Invoices") return;

    var targetUrl = InvoiceAIAgent.WIDGET_URL +
      "?id=" + encodeURIComponent(ctx.recordId || "") +
      "&name=" + encodeURIComponent(ctx.recordName || "") +
      "&customer=" + encodeURIComponent(ctx.customerName || "") +
      "&total=" + encodeURIComponent(ctx.totalAmount || "") +
      "&duedate=" + encodeURIComponent(ctx.dueDate || "") +
      "&type=" + encodeURIComponent(ctx.entityName || "invoice");

    var lastIdentifier = drawer.getAttribute("data-synced-identifier") || "";
    if (activeIdentifier !== lastIdentifier) {
      drawer.setAttribute("data-synced-identifier", activeIdentifier);
      drawer.setAttribute("data-synced-id", ctx.recordId || "");
      frame.src = targetUrl;
    }
  } catch (e) {
    console.error("Error in refreshDrawerContext:", e);
  }
};

/**
 * Check if the active screen is an Invoice or Quote screen (Record Form OR List/Grid view)
 */
InvoiceAIAgent.isInvoiceActive = function () {
  try {
    var topWin = window.top || window;
    var href = (topWin.location && topWin.location.href) || "";

    // 1. If explicitly navigated to other entities (Leads, Contacts, Accounts, etc.) -> Return false!
    if (href.indexOf("etn=lead") !== -1 ||
      href.indexOf("etn=account") !== -1 ||
      href.indexOf("etn=contact") !== -1 ||
      href.indexOf("etn=opportunity") !== -1) {
      return false;
    }

    // 2. If URL contains etn=invoice or etn=quote (Works for BOTH pagetype=entitylist AND pagetype=entityrecord!)
    if (href.indexOf("etn=invoice") !== -1 || href.indexOf("etn=quote") !== -1) {
      return true;
    }

    // 3. Check CRM formContext if available
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (window.top && window.top.Xrm);
    var fc = InvoiceAIAgent.currentFormContext || (xrm && xrm.Page);
    if (fc && fc.data && fc.data.entity) {
      var ent = fc.data.entity.getEntityName();
      if (ent === "invoice" || ent === "quote") {
        return true;
      }
    }

    // 4. Fallback check for URL keywords
    if (href.indexOf("invoice") !== -1 || href.indexOf("quote") !== -1) {
      return true;
    }

    return false;
  } catch (e) {
    return false;
  }
};

// Backward-compatible alias
InvoiceAIAgent.isInvoiceFormActive = InvoiceAIAgent.isInvoiceActive;

/**
 * Clean up / Remove button and drawer from screen
 */
InvoiceAIAgent.cleanup = function () {
  try {
    var topWin = window.top || window;
    var targetDoc = topWin.document || document;
    var fab = targetDoc.getElementById("d365-invoice-ai-fab");
    if (fab && fab.parentNode) {
      fab.parentNode.removeChild(fab);
    }
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    if (drawer && drawer.parentNode) {
      drawer.parentNode.removeChild(drawer);
    }
    if (topWin.__d365InvoiceWatcher) {
      topWin.clearInterval(topWin.__d365InvoiceWatcher);
      topWin.__d365InvoiceWatcher = null;
    }
  } catch (e) { }
};

/**
 * Navigation Watcher: Keeps Agent active across Invoice List and Record views,
 * and seamlessly cleans up ONLY when user navigates away to Leads, Accounts, etc.
 */
InvoiceAIAgent.startNavigationWatcher = function () {
  try {
    var topWin = window.top || window;

    // Standalone cleanup function attached to topWin
    topWin.__d365InvoiceCleanup = function () {
      try {
        var doc = topWin.document;
        var fab = doc.getElementById("d365-invoice-ai-fab");
        var drawer = doc.getElementById("d365-invoice-ai-drawer");
        if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
        if (drawer && drawer.parentNode) drawer.parentNode.removeChild(drawer);
      } catch (ex) { }
    };

    // Global active check on topWin: supports BOTH entitylist and entityrecord
    topWin.__isInvoiceActive = function () {
      try {
        var href = (topWin.location && topWin.location.href) || "";
        // Only return false if explicitly on other known entities
        if (href.indexOf("etn=lead") !== -1 ||
          href.indexOf("etn=account") !== -1 ||
          href.indexOf("etn=contact") !== -1 ||
          href.indexOf("etn=opportunity") !== -1) {
          return false;
        }
        // Active if on invoice or quote (grid or form)
        if (href.indexOf("invoice") !== -1 || href.indexOf("quote") !== -1) {
          return true;
        }
        // Check Xrm Page entity name if available
        var xrm = topWin.Xrm || (topWin.parent && topWin.parent.Xrm);
        if (xrm && xrm.Page && xrm.Page.data && xrm.Page.data.entity) {
          var ent = xrm.Page.data.entity.getEntityName();
          if (ent === "invoice" || ent === "quote") return true;
        }
        // Default to keeping active during CRM internal page transitions
        return true;
      } catch (ex) {
        return true;
      }
    };

    // 1. Clear any existing watcher on topWin
    if (topWin.__d365InvoiceWatcher) {
      topWin.clearInterval(topWin.__d365InvoiceWatcher);
      topWin.__d365InvoiceWatcher = null;
    }

    // Debounce counter to prevent accidental flickering
    var nonInvoiceCount = 0;

    // 2. Stable periodic watcher (Smooth 1.2s check, zero flickering)
    topWin.__d365InvoiceWatcher = topWin.setInterval(function () {
      try {
        var isActive = topWin.__isInvoiceActive && topWin.__isInvoiceActive();

        if (!isActive) {
          nonInvoiceCount++;
          // Only clean up after 3 consecutive negative checks (approx 3.6s)
          // so temporary CRM internal URL transitions NEVER cause flickering
          if (nonInvoiceCount >= 3) {
            topWin.__d365InvoiceCleanup();
            topWin.clearInterval(topWin.__d365InvoiceWatcher);
            topWin.__d365InvoiceWatcher = null;
          }
          return;
        }

        // Reset debounce count since we are on invoice
        nonInvoiceCount = 0;

        var doc = topWin.document;
        var fab = doc.getElementById("d365-invoice-ai-fab");
        var drawer = doc.getElementById("d365-invoice-ai-drawer");

        // Ensure FAB and Drawer exist without flashing
        if (!fab && typeof InvoiceAIAgent !== "undefined" && InvoiceAIAgent.initUI) {
          InvoiceAIAgent.initUI();
          fab = doc.getElementById("d365-invoice-ai-fab");
          drawer = doc.getElementById("d365-invoice-ai-drawer");
        }

        // Context Synchronization in periodic watcher (Crucial for Focused View / Split Screen):
        if (drawer && drawer.getAttribute("data-open") === "true") {
          var curCtx = (typeof InvoiceAIAgent !== "undefined" && InvoiceAIAgent.getContext)
            ? InvoiceAIAgent.getContext()
            : null;

          if (curCtx && (curCtx.recordId || curCtx.customerName)) {
            var activeIdf = curCtx.recordId || curCtx.customerName;
            var lastIdf = drawer.getAttribute("data-synced-identifier") || "";
            if (activeIdf !== lastIdf) {
              InvoiceAIAgent.refreshDrawerContext(curCtx);
            }
          }
        }
      } catch (e) { }
    }, 800);

  } catch (e) {
    console.warn("Could not setup top window navigation watcher:", e);
  }
};

/**
 * Close any old native side pane to remove the right-rail icon
 */
InvoiceAIAgent.closeNativeSidePane = function () {
  try {
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (window.top && window.top.Xrm);
    if (xrm && xrm.App && xrm.App.sidePanes) {
      var pane = xrm.App.sidePanes.getPane("InvoiceAIAgentSidePane");
      if (pane) pane.close();
    }
  } catch (e) { }
};

/**
 * Extract active Invoice / Quote context from form
 */
InvoiceAIAgent.getContext = function (primaryControl, selectedControl) {
  var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (window.top && window.top.Xrm);
  var recordId = "";
  var recordName = "";
  var customerName = "";
  var totalAmount = "";
  var entityName = "invoice";

  // 1. Check formContext from topWin or local (Handles Focused View)
  try {
    var fc = InvoiceAIAgent.currentFormContext || topWin.__currentInvoiceFormContext ||
      (primaryControl && primaryControl.data ? primaryControl : null) ||
      (xrm && xrm.Page && xrm.Page.data ? xrm.Page : null);

    if (fc && fc.data && fc.data.entity) {
      var rawId = fc.data.entity.getId();
      if (rawId) recordId = rawId.replace(/[{}]/g, "");

      entityName = fc.data.entity.getEntityName() || "invoice";

      var nameAttr = fc.getAttribute("name");
      if (nameAttr && nameAttr.getValue()) recordName = nameAttr.getValue();

      var custAttr = fc.getAttribute("customerid") || fc.getAttribute("potentialcustomerid");
      if (custAttr && custAttr.getValue() && custAttr.getValue()[0]) {
        customerName = custAttr.getValue()[0].name || "";
      }

      var amtAttr = fc.getAttribute("totalamount");
      if (amtAttr && amtAttr.getValue()) totalAmount = amtAttr.getValue();

      var dueAttr = fc.getAttribute("duedate");
      var dueDate = "";
      if (dueAttr && dueAttr.getValue()) {
        var d = dueAttr.getValue();
        dueDate = (d instanceof Date) ? d.toISOString().split("T")[0] : String(d);
      }
    }
  } catch (ex) {
    console.warn("Could not extract invoice/quote context:", ex);
  }

  // 2. Check UCI page context if not found
  if (!recordId && xrm && xrm.Utility && xrm.Utility.getPageContext) {
    try {
      var pCtx = xrm.Utility.getPageContext();
      if (pCtx && pCtx.input && pCtx.input.entityId) {
        recordId = pCtx.input.entityId.replace(/[{}]/g, "");
      }
    } catch (ePage) { }
  }

  // 3. Fallback from DOM Header in Focused View
  try {
    var headerEl = topWin.document.querySelector('[data-id="header_title"]') || topWin.document.querySelector('h1[data-id="header_title"]');
    if (headerEl && headerEl.textContent) {
      var hTitle = headerEl.textContent.trim();
      if (hTitle && hTitle.startsWith("Sales Invoice")) {
        recordName = hTitle;
        var pName = hTitle.replace(/Sales\s*Invoice\s*-\s*/i, "").trim();
        if (pName && (!customerName || customerName === "Valued Customer" || customerName === "Hi Customer")) {
          customerName = pName;
        }
      }
    }
  } catch (eDom) { }

  // 4. Check Grid selection if called from Grid with selectedControl / primaryControl
  if (!recordId) {
    try {
      var gridControl = selectedControl || (primaryControl && primaryControl.getGrid ? primaryControl : null);
      if (gridControl && gridControl.getGrid) {
        var selectedRows = gridControl.getGrid().getSelectedRows();
        if (selectedRows && selectedRows.getLength && selectedRows.getLength() > 0) {
          var firstRow = selectedRows.get(0);
          var data = firstRow.getData && firstRow.getData();
          if (data && data.entity) {
            recordId = (data.entity.getId() || "").replace(/[{}]/g, "");
            recordName = data.entity.getPrimaryAttributeValue() || "";
          }
        }
      }
    } catch (eGrid) { }
  }

  // Also check URL for entity
  try {
    var href = (topWin.location && topWin.location.href) || "";
    if (href.indexOf("etn=quote") !== -1) entityName = "quote";
    if (href.indexOf("etn=invoice") !== -1) entityName = "invoice";
  } catch (e) { }

  return {
    recordId: recordId,
    recordName: recordName,
    customerName: customerName,
    totalAmount: totalAmount,
    dueDate: dueDate,
    entityName: entityName
  };
};

/**
 * Refresh the drawer's iframe src with current Invoice context
 */
InvoiceAIAgent.refreshDrawerContext = function (forcedContext) {
  try {
    var topWin = window.top || window;
    var targetDoc = topWin.document || document;
    var frame = targetDoc.getElementById("d365-invoice-ai-frame");
    if (!frame) return;

    var ctx = forcedContext || InvoiceAIAgent.getContext();
    var targetUrl = InvoiceAIAgent.WIDGET_URL +
      "?id=" + encodeURIComponent(ctx.recordId || "") +
      "&name=" + encodeURIComponent(ctx.recordName || "") +
      "&customer=" + encodeURIComponent(ctx.customerName || "") +
      "&total=" + encodeURIComponent(ctx.totalAmount || "") +
      "&duedate=" + encodeURIComponent(ctx.dueDate || "") +
      "&type=" + encodeURIComponent(ctx.entityName || "invoice");

    if (frame.src !== targetUrl && (!frame.src.includes(ctx.recordId) || !ctx.recordId)) {
      frame.src = targetUrl;
    }
  } catch (e) {
    console.error("Error in refreshDrawerContext:", e);
  }
};

/**
 * Toggle the Floating Drawer (Exact matching img2 UI)
 */
InvoiceAIAgent.toggleDrawer = function (primaryControl, selectedControl) {
  try {
    var topWin = window.top || window;
    var targetDoc = topWin.document || document;
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    var fab = targetDoc.getElementById("d365-invoice-ai-fab");
    if (!drawer) {
      InvoiceAIAgent.initUI();
      drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
      fab = targetDoc.getElementById("d365-invoice-ai-fab");
    }
    if (!drawer) return;

    var isCurrentlyOpen = (drawer.getAttribute("data-open") === "true");
    var willOpen = !isCurrentlyOpen;
    drawer.setAttribute("data-open", willOpen ? "true" : "false");

    if (willOpen) {
      // 1. Refresh active Invoice context
      InvoiceAIAgent.refreshDrawerContext();

      // 2. Show Drawer
      drawer.style.display = "flex";
      setTimeout(function () {
        drawer.style.opacity = "1";
        drawer.style.transform = "translateY(0) scale(1)";
        drawer.style.pointerEvents = "auto";
      }, 10);

      // 3. Transform FAB icon to Close (✕)
      if (fab) {
        fab.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
        fab.title = "Close Invoice AI Agent";
      }
    } else {
      // Hide Drawer
      drawer.style.opacity = "0";
      drawer.style.transform = "translateY(16px) scale(0.96)";
      drawer.style.pointerEvents = "none";
      setTimeout(function () {
        if (drawer.getAttribute("data-open") !== "true") {
          drawer.style.display = "none";
        }
      }, 250);

      // Restore FAB icon to Sparkle (✨)
      if (fab) {
        fab.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" fill="white"/>
            <path d="M19 16L19.9 19.1L23 20L19.9 20.9L19 24L18.1 20.9L15 20L18.1 19.1L19 16Z" fill="#FDE047"/>
          </svg>
        `;
        fab.title = "Invoice AI Agent";
      }
    }
  } catch (e) {
    console.error("Error in toggleDrawer:", e);
  }
};

InvoiceAIAgent.openDrawer = function (primaryControl, selectedControl) {
  var topWin = window.top || window;
  var targetDoc = topWin.document || document;
  var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
  if (!drawer || drawer.getAttribute("data-open") !== "true") {
    InvoiceAIAgent.toggleDrawer(primaryControl, selectedControl);
  }
};

InvoiceAIAgent.closeDrawer = function () {
  var topWin = window.top || window;
  var targetDoc = topWin.document || document;
  var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
  if (drawer && drawer.getAttribute("data-open") === "true") {
    InvoiceAIAgent.toggleDrawer();
  }
};

/**
 * Initialize Floating Button and Floating Card UI (Matching img2)
 */
InvoiceAIAgent.initUI = function () {
  try {
    var topWin = window.top || window;
    var targetDoc = topWin.document || document;

    var existingFab = targetDoc.getElementById("d365-invoice-ai-fab");
    var existingDrawer = targetDoc.getElementById("d365-invoice-ai-drawer");

    // If elements already exist, re-bind click handler
    if (existingFab && existingDrawer) {
      existingFab.style.display = "flex";
      existingFab.onclick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var agent = topWin.__InvoiceAIAgent || topWin.InvoiceAIAgent || window.InvoiceAIAgent || InvoiceAIAgent;
        agent.toggleDrawer();
      };
      return;
    }

    // 1. Create Floating Action Button (FAB)
    var fab = targetDoc.createElement("div");
    fab.id = "d365-invoice-ai-fab";
    fab.title = "Invoice AI Agent";
    fab.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" fill="white"/>
        <path d="M19 16L19.9 19.1L23 20L19.9 20.9L19 24L18.1 20.9L15 20L18.1 19.1L19 16Z" fill="#FDE047"/>
      </svg>
    `;

    Object.assign(fab.style, {
      position: "fixed",
      bottom: "26px",
      right: "26px",
      width: "54px",
      height: "54px",
      borderRadius: "50%",
      background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #4338ca 100%)",
      boxShadow: "0 6px 20px rgba(79, 70, 229, 0.45), 0 2px 6px rgba(0,0,0,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      zIndex: "9999999",
      transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      userSelect: "none"
    });

    fab.onmouseenter = function () {
      fab.style.transform = "scale(1.1) translateY(-2px)";
      fab.style.boxShadow = "0 10px 28px rgba(79, 70, 229, 0.55), 0 4px 10px rgba(0,0,0,0.22)";
    };
    fab.onmouseleave = function () {
      fab.style.transform = "scale(1) translateY(0px)";
      fab.style.boxShadow = "0 6px 20px rgba(79, 70, 229, 0.45), 0 2px 6px rgba(0,0,0,0.18)";
    };
    fab.onmousedown = function () {
      fab.style.transform = "scale(0.95)";
    };
    fab.onmouseup = function () {
      fab.style.transform = "scale(1.1) translateY(-2px)";
    };

    fab.onclick = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      var agent = topWin.__InvoiceAIAgent || topWin.InvoiceAIAgent || window.InvoiceAIAgent || InvoiceAIAgent;
      agent.toggleDrawer();
    };

    // 2. Create Floating Drawer Container (Exact matching img2)
    var drawer = targetDoc.createElement("div");
    drawer.id = "d365-invoice-ai-drawer";
    drawer.setAttribute("data-open", "false");
    Object.assign(drawer.style, {
      position: "fixed",
      bottom: "92px",
      right: "26px",
      width: "420px",
      maxWidth: "calc(100vw - 40px)",
      height: "640px",
      maxHeight: "calc(100vh - 120px)",
      backgroundColor: "#ffffff",
      borderRadius: "16px",
      boxShadow: "0 14px 44px rgba(15, 23, 42, 0.25), 0 4px 14px rgba(79, 70, 229, 0.15)",
      border: "1px solid rgba(226, 232, 240, 0.9)",
      overflow: "hidden",
      zIndex: "9999998",
      display: "none",
      flexDirection: "column",
      opacity: "0",
      transform: "translateY(16px) scale(0.96)",
      transition: "opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
    });

    // 3. Create Iframe inside drawer
    var iframe = targetDoc.createElement("iframe");
    iframe.id = "d365-invoice-ai-frame";
    iframe.src = "about:blank";
    iframe.allow = "clipboard-read; clipboard-write; microphone";
    Object.assign(iframe.style, {
      width: "100%",
      height: "100%",
      border: "none",
      display: "block"
    });

    drawer.appendChild(iframe);

    // Append to document body
    targetDoc.body.appendChild(drawer);
    targetDoc.body.appendChild(fab);

    console.log("Invoice AI Agent Floating Card UI (img2 style) initialized successfully.");
  } catch (err) {
    console.warn("initUI error:", err);
  }
};

/**
 * 🚀 Open Copilot-Style Full-Height Right Side Pane (for Top Ribbon Command Button)
 */
InvoiceAIAgent.openSidePane = function (primaryControl, selectedControl) {
  try {
    InvoiceAIAgent.closeDrawer();

    var targetDoc = window.top.document || document;
    var ctx = InvoiceAIAgent.getContext(primaryControl, selectedControl);
    var targetUrl = InvoiceAIAgent.WIDGET_URL +
      "?id=" + encodeURIComponent(ctx.recordId || "") +
      "&name=" + encodeURIComponent(ctx.recordName || "") +
      "&customer=" + encodeURIComponent(ctx.customerName || "") +
      "&total=" + encodeURIComponent(ctx.totalAmount || "") +
      "&duedate=" + encodeURIComponent(ctx.dueDate || "") +
      "&type=" + encodeURIComponent(ctx.entityName || "invoice");

    // Direct Copilot-Style Full-Height Side Pane (Reliable, Zero Dependencies!)
    InvoiceAIAgent.openDockedSidePane(targetUrl);
  } catch (err) {
    console.error("Error in openSidePane:", err);
    InvoiceAIAgent.openDockedSidePane(InvoiceAIAgent.WIDGET_URL);
  }
};

InvoiceAIAgent.openDockedSidePane = function (targetUrl) {
  try {
    var topWin = window.top || window;
    var targetDoc = topWin.document || document;
    var existingPane = targetDoc.getElementById("d365-invoice-ai-sidepane");

    // Squeeze / Push main Dynamics 365 page to the left (Exact matching Copilot img2 layout!)
    function squeezePage(enable) {
      try {
        var mainEl = targetDoc.querySelector('[data-id="app-main-content"]') ||
          targetDoc.querySelector('#mainContent') ||
          targetDoc.querySelector('[data-id="main-container"]') ||
          targetDoc.querySelector('main') ||
          targetDoc.body;

        if (mainEl) {
          mainEl.style.transition = "margin-right 0.28s cubic-bezier(0.16, 1, 0.3, 1)";
          mainEl.style.marginRight = enable ? "440px" : "0px";
        }
      } catch (e) { }
    }

    if (!existingPane) {
      existingPane = targetDoc.createElement("div");
      existingPane.id = "d365-invoice-ai-sidepane";
      Object.assign(existingPane.style, {
        position: "fixed",
        top: "48px",
        right: "0px",
        width: "440px",
        maxWidth: "92vw",
        height: "calc(100vh - 48px)",
        backgroundColor: "#ffffff",
        boxShadow: "-4px 0 20px rgba(15, 23, 42, 0.12)",
        borderLeft: "1px solid #e2e8f0",
        zIndex: "9999",
        display: "flex",
        flexDirection: "column",
        transition: "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        transform: "translateX(100%)"
      });

      var header = targetDoc.createElement("div");
      Object.assign(header.style, {
        height: "48px",
        padding: "0 16px",
        borderBottom: "1px solid #e2e8f0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#f8fafc"
      });
      header.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;color:#1e293b;">
          <span style="font-size:17px;">🧾</span> Invoice & Billing AI
        </div>
        <button id="d365-invoice-sidepane-close" style="border:none;background:transparent;cursor:pointer;font-size:18px;color:#64748b;padding:4px 8px;border-radius:4px;line-height:1;" title="Close">✕</button>
      `;

      var iframe = targetDoc.createElement("iframe");
      iframe.id = "d365-invoice-sidepane-frame";
      iframe.allow = "clipboard-read; clipboard-write; microphone";
      Object.assign(iframe.style, {
        flex: "1",
        width: "100%",
        border: "none",
        display: "block"
      });

      existingPane.appendChild(header);
      existingPane.appendChild(iframe);
      targetDoc.body.appendChild(existingPane);

      targetDoc.getElementById("d365-invoice-sidepane-close").onclick = function () {
        existingPane.style.transform = "translateX(100%)";
        squeezePage(false);
      };
    }

    var frame = targetDoc.getElementById("d365-invoice-sidepane-frame");
    if (frame) frame.src = targetUrl;

    setTimeout(function () {
      existingPane.style.transform = "translateX(0)";
      squeezePage(true);
    }, 20);
  } catch (e) {
    console.error("Error in openDockedSidePane:", e);
  }
};

// Ribbon & Global Aliases (Command Bar button triggers Copilot-style Side Pane!)
InvoiceAIAgent.openFromRibbon = InvoiceAIAgent.openSidePane;
InvoiceAIAgent.openInvoiceAI = InvoiceAIAgent.openSidePane;
InvoiceAIAgent.ribbonClick = InvoiceAIAgent.openSidePane;

// Attach globally to topWin and window so it survives iframe destruction
topWin.__InvoiceAIAgent = InvoiceAIAgent;
topWin.InvoiceAIAgent = InvoiceAIAgent;
topWin.openInvoiceAIAgent = InvoiceAIAgent.openSidePane;
topWin.openFromRibbon = InvoiceAIAgent.openSidePane;
topWin.openInvoiceAI = InvoiceAIAgent.openSidePane;
if (typeof window !== "undefined") {
  window.openInvoiceAIAgent = InvoiceAIAgent.openSidePane;
  window.openFromRibbon = InvoiceAIAgent.openSidePane;
  window.openInvoiceAI = InvoiceAIAgent.openSidePane;
}

// Auto-run ONLY if on the Invoice/Quote record form or list
if (typeof window !== "undefined") {
  InvoiceAIAgent.closeNativeSidePane();
  if (InvoiceAIAgent.isInvoiceFormActive()) {
    InvoiceAIAgent.initUI();
    InvoiceAIAgent.startNavigationWatcher();
  } else {
    InvoiceAIAgent.cleanup();
  }
}


