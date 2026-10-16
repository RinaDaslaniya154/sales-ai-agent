/**
 * Dynamics 365 Floating Action Button (FAB) & Floating Drawer for Invoice & Quote AI Agent
 * - Single modern Floating Action Button (✨) at bottom-right (Emerald / Teal gradient)
 * - Click once -> Smoothly opens the AI Invoice Agent Floating Drawer
 * - Click again or click Close (✕) -> Closes the Drawer
 * - Works on BOTH Invoice and Quotation records & grids
 * - AUTO-CLEANUP on Page Navigation: Automatically removes button when moving away to other pages
 * - Passes active record context (Invoice ID, Quote ID, Customer Name, Total Amount)
 */

var InvoiceAIAgent = window.InvoiceAIAgent || {};

// Active Cloudflare Tunnel Live URL for Invoice AI Agent (Superfast Local Server)
InvoiceAIAgent.WIDGET_URL = "https://forwarding-pdf-agenda-photo.trycloudflare.com/invoice";

InvoiceAIAgent.currentFormContext = null;
InvoiceAIAgent.watcherInterval = null;

/**
 * Dynamics 365 Form OnLoad / Ribbon Handler
 */
InvoiceAIAgent.onLoad = function (executionContext) {
  try {
    if (executionContext && executionContext.getFormContext) {
      InvoiceAIAgent.currentFormContext = executionContext.getFormContext();
    }

    // Strictly ensure we are on the Invoice / Quote record form!
    if (!InvoiceAIAgent.isInvoiceFormActive()) {
      InvoiceAIAgent.cleanup();
      return;
    }

    // 1. Close any legacy native side pane if opened previously
    InvoiceAIAgent.closeNativeSidePane();

    // 2. Inject or show floating button & popup drawer for Invoice/Quote
    InvoiceAIAgent.initUI();

    // 3. Start navigation watcher to clean up the second user leaves Invoice form
    InvoiceAIAgent.startNavigationWatcher();
  } catch (err) {
    console.error("Error in InvoiceAIAgent.onLoad:", err);
  }
};

/**
 * Check if the active screen is strictly an Invoice or Quote Record Form (NOT list/grid)
 */
InvoiceAIAgent.isInvoiceFormActive = function () {
  try {
    var topWin = window.top || window;
    var href = (topWin.location && topWin.location.href) || "";

    // 1. If pagetype is entitylist (All Invoices / Views), it is NOT the record form -> Return false!
    if (href.indexOf("pagetype=entitylist") !== -1) {
      return false;
    }

    // 2. If URL contains other entities (Leads, Contacts, Accounts, etc.) -> Return false!
    if (href.indexOf("etn=lead") !== -1 || href.indexOf("etn=account") !== -1 || href.indexOf("etn=contact") !== -1 || href.indexOf("etn=opportunity") !== -1) {
      return false;
    }

    // 3. Must be an entityrecord with etn=invoice or etn=quote
    var isRecord = (href.indexOf("pagetype=entityrecord") !== -1) || (href.indexOf("id=") !== -1);
    var isInvoice = (href.indexOf("etn=invoice") !== -1) || (href.indexOf("etn=quote") !== -1);
    if (isRecord && isInvoice) {
      return true;
    }

    // 4. Check CRM formContext
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (window.top && window.top.Xrm);
    var fc = InvoiceAIAgent.currentFormContext || (xrm && xrm.Page);
    if (fc && fc.data && fc.data.entity) {
      var ent = fc.data.entity.getEntityName();
      var id = fc.data.entity.getId();
      if ((ent === "invoice" || ent === "quote") && id) {
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
};

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
 * Navigation Watcher: Monitors when user leaves Invoice Form (e.g. back to All Invoices, Leads, etc.)
 * Runs on window.top directly so it survives form iframe destruction in Dynamics 365
 */
InvoiceAIAgent.startNavigationWatcher = function () {
  try {
    var topWin = window.top || window;

    // Attach standalone cleanup & checker directly on topWin so it survives iframe destruction
    topWin.__d365InvoiceCleanup = function () {
      try {
        var doc = topWin.document;
        var fab = doc.getElementById("d365-invoice-ai-fab");
        var drawer = doc.getElementById("d365-invoice-ai-drawer");
        if (fab && fab.parentNode) fab.parentNode.removeChild(fab);
        if (drawer && drawer.parentNode) drawer.parentNode.removeChild(drawer);
      } catch (ex) { }
    };

    topWin.__isInvoiceActive = function () {
      try {
        var href = (topWin.location && topWin.location.href) || "";
        // If on entity list (grid), return false
        if (href.indexOf("pagetype=entitylist") !== -1) return false;
        // If explicitly navigated to other entities (Lead, Account, Contact, Opportunity)
        if (href.indexOf("etn=lead") !== -1 || href.indexOf("etn=account") !== -1 || href.indexOf("etn=contact") !== -1 || href.indexOf("etn=opportunity") !== -1) {
          return false;
        }
        // Must contain etn=invoice or etn=quote
        var isInvoice = (href.indexOf("etn=invoice") !== -1) || (href.indexOf("etn=quote") !== -1);
        if (!isInvoice) return false;
        return true;
      } catch (ex) {
        return false;
      }
    };

    // 1. Clear any existing watcher on topWin
    if (topWin.__d365InvoiceWatcher) {
      topWin.clearInterval(topWin.__d365InvoiceWatcher);
    }

    // 2. Set interval directly ON topWin (so it doesn't get killed when CRM unloads form iframe)
    topWin.__d365InvoiceWatcher = topWin.setInterval(function () {
      try {
        if (topWin.__isInvoiceActive && !topWin.__isInvoiceActive()) {
          topWin.__d365InvoiceCleanup();
          topWin.clearInterval(topWin.__d365InvoiceWatcher);
          topWin.__d365InvoiceWatcher = null;
        }
      } catch (e) { }
    }, 300);

    // 3. Hook into Dynamics 365 History navigation (pushState & replaceState) for instant 0ms cleanup
    if (!topWin.__d365NavHooked) {
      topWin.__d365NavHooked = true;
      var origPushState = topWin.history.pushState;
      topWin.history.pushState = function () {
        var ret = origPushState.apply(this, arguments);
        try {
          if (topWin.__isInvoiceActive && !topWin.__isInvoiceActive()) {
            if (topWin.__d365InvoiceCleanup) topWin.__d365InvoiceCleanup();
          }
        } catch (e) { }
        return ret;
      };

      var origReplaceState = topWin.history.replaceState;
      topWin.history.replaceState = function () {
        var ret = origReplaceState.apply(this, arguments);
        try {
          if (topWin.__isInvoiceActive && !topWin.__isInvoiceActive()) {
            if (topWin.__d365InvoiceCleanup) topWin.__d365InvoiceCleanup();
          }
        } catch (e) { }
        return ret;
      };
    }

    // 4. Also listen to hashchange and popstate
    topWin.addEventListener("popstate", function () {
      if (topWin.__isInvoiceActive && !topWin.__isInvoiceActive()) {
        if (topWin.__d365InvoiceCleanup) topWin.__d365InvoiceCleanup();
      }
    });
    topWin.addEventListener("hashchange", function () {
      if (topWin.__isInvoiceActive && !topWin.__isInvoiceActive()) {
        if (topWin.__d365InvoiceCleanup) topWin.__d365InvoiceCleanup();
      }
    });

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

  // 1. Check if called from Grid with selectedControl / primaryControl
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

  // 2. Check if called on a form
  try {
    var fc = InvoiceAIAgent.currentFormContext || (primaryControl && primaryControl.data ? primaryControl : null) || (xrm && xrm.Page && xrm.Page.data ? xrm.Page : null);
    if (!recordId && fc && fc.data && fc.data.entity) {
      var rawId = fc.data.entity.getId();
      if (rawId) recordId = rawId.replace(/[{}]/g, "");

      entityName = fc.data.entity.getEntityName() || "invoice";

      var nameAttr = fc.getAttribute("name");
      if (nameAttr && nameAttr.getValue()) recordName = nameAttr.getValue();

      var custAttr = fc.getAttribute("customerid");
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

  // Also check URL for entity
  try {
    var topWin = window.top || window;
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
 * Open Floating Drawer directly (for Ribbon / Button clicks)
 */
InvoiceAIAgent.openDrawer = function (primaryControl, selectedControl) {
  try {
    InvoiceAIAgent.closeNativeSidePane();
    InvoiceAIAgent.initUI();
    InvoiceAIAgent.startNavigationWatcher();

    var targetDoc = window.top.document || document;
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    var fab = targetDoc.getElementById("d365-invoice-ai-fab");

    if (!drawer) {
      console.warn("Could not find d365-invoice-ai-drawer");
      return;
    }

    var ctx = InvoiceAIAgent.getContext(primaryControl, selectedControl);
    var frame = targetDoc.getElementById("d365-invoice-ai-frame");
    var targetUrl = InvoiceAIAgent.WIDGET_URL +
      "?id=" + encodeURIComponent(ctx.recordId || "") +
      "&name=" + encodeURIComponent(ctx.recordName || "") +
      "&customer=" + encodeURIComponent(ctx.customerName || "") +
      "&total=" + encodeURIComponent(ctx.totalAmount || "") +
      "&duedate=" + encodeURIComponent(ctx.dueDate || "") +
      "&type=" + encodeURIComponent(ctx.entityName || "invoice");

    if (frame && (!frame.src || frame.src === "about:blank" || (ctx.recordId && !frame.src.includes(ctx.recordId)))) {
      frame.src = targetUrl;
    }

    drawer.setAttribute("data-open", "true");
    drawer.style.display = "flex";
    setTimeout(function () {
      drawer.style.opacity = "1";
      drawer.style.transform = "translateY(0) scale(1)";
      drawer.style.pointerEvents = "auto";
    }, 10);

    if (fab) {
      fab.innerHTML = `
        <svg style="pointer-events:none;" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      fab.title = "Close Invoice AI Agent";
    }
  } catch (e) {
    console.error("Error in openDrawer:", e);
  }
};

/**
 * Close Floating Drawer
 */
InvoiceAIAgent.closeDrawer = function () {
  try {
    var targetDoc = window.top.document || document;
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    var fab = targetDoc.getElementById("d365-invoice-ai-fab");

    if (drawer) {
      drawer.setAttribute("data-open", "false");
      drawer.style.opacity = "0";
      drawer.style.transform = "translateY(16px) scale(0.96)";
      drawer.style.pointerEvents = "none";
      setTimeout(function () {
        if (drawer.getAttribute("data-open") !== "true") {
          drawer.style.display = "none";
        }
      }, 250);
    }

    if (fab) {
      fab.innerHTML = `
        <svg style="pointer-events:none;" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" fill="white"/>
          <path d="M19 16L19.9 19.1L23 20L19.9 20.9L19 24L18.1 20.9L15 20L18.1 19.1L19 16Z" fill="#FDE047"/>
        </svg>
      `;
      fab.title = "Invoice AI Agent";
    }
  } catch (e) {
    console.error("Error in closeDrawer:", e);
  }
};

/**
 * Toggle the Floating Drawer (100% Reliable, Direct State)
 */
InvoiceAIAgent.toggleDrawer = function (primaryControl, selectedControl) {
  try {
    var targetDoc = window.top.document || document;
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    if (!drawer) {
      InvoiceAIAgent.initUI();
      drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    }

    var isCurrentlyOpen = (drawer && drawer.getAttribute("data-open") === "true");

    if (!isCurrentlyOpen) {
      InvoiceAIAgent.openDrawer(primaryControl, selectedControl);
    } else {
      InvoiceAIAgent.closeDrawer();
    }
  } catch (e) {
    console.error("Error in toggleDrawer:", e);
  }
};

/**
 * Initialize Floating Button and Floating Card UI
 */
InvoiceAIAgent.initUI = function () {
  try {
    var targetDoc = window.top.document || document;

    var existingFab = targetDoc.getElementById("d365-invoice-ai-fab");
    var existingDrawer = targetDoc.getElementById("d365-invoice-ai-drawer");

    // If both elements already exist, ensure visible and re-bind click
    if (existingFab && existingDrawer) {
      existingFab.style.display = "flex";
      existingFab.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        InvoiceAIAgent.toggleDrawer();
      };
      return;
    }

    // Clean up any half-created or orphaned elements
    if (existingFab && !existingDrawer) {
      if (existingFab.parentNode) existingFab.parentNode.removeChild(existingFab);
    }
    if (existingDrawer && !existingFab) {
      if (existingDrawer.parentNode) existingDrawer.parentNode.removeChild(existingDrawer);
    }

    // 1. Create Floating Action Button (FAB)
    var fab = targetDoc.createElement("div");
    fab.id = "d365-invoice-ai-fab";
    fab.title = "Invoice AI Agent";
    fab.innerHTML = `
      <svg style="pointer-events:none;" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" fill="white"/>
        <path d="M19 16L19.9 19.1L23 20L19.9 20.9L19 24L18.1 20.9L15 20L18.1 19.1L19 16Z" fill="#FDE047"/>
      </svg>
    `;

    // Apply Styles (Indigo gradient matching Send button & primary theme)
    Object.assign(fab.style, {
      position: "fixed",
      bottom: "26px",
      right: "26px",
      width: "54px",
      height: "54px",
      borderRadius: "50%",
      background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
      boxShadow: "0 6px 20px rgba(79, 70, 229, 0.45), 0 2px 6px rgba(0,0,0,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      zIndex: "9999999",
      transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      userSelect: "none",
      pointerEvents: "auto"
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
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      InvoiceAIAgent.toggleDrawer();
    };

    // 2. Create Floating Drawer Container
    var drawer = targetDoc.createElement("div");
    drawer.id = "d365-invoice-ai-drawer";
    drawer.setAttribute("data-open", "false");
    Object.assign(drawer.style, {
      position: "fixed",
      bottom: "92px",
      right: "26px",
      width: "440px",
      maxWidth: "calc(100vw - 40px)",
      height: "660px",
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

    console.log("Invoice AI Agent Modern Floating Drawer initialized successfully.");
  } catch (err) {
    console.error("Failed to initialize Invoice AI UI:", err);
  }
};

// Ribbon & Global Aliases (so whatever function was set in Ribbon Workbench works seamlessly)
InvoiceAIAgent.openFromRibbon = InvoiceAIAgent.openDrawer;
InvoiceAIAgent.openSidePane = InvoiceAIAgent.openDrawer;
InvoiceAIAgent.openInvoiceAI = InvoiceAIAgent.openDrawer;
InvoiceAIAgent.ribbonClick = InvoiceAIAgent.openDrawer;

// Auto-run ONLY if on the Invoice/Quote record form
if (typeof window !== "undefined") {
  InvoiceAIAgent.closeNativeSidePane();
  if (InvoiceAIAgent.isInvoiceFormActive()) {
    InvoiceAIAgent.initUI();
    InvoiceAIAgent.startNavigationWatcher();
  } else {
    InvoiceAIAgent.cleanup();
  }
}


