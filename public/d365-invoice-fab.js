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

// Permanent Cloud Live URL for Invoice AI Agent (Render.com)
InvoiceAIAgent.WIDGET_URL = "https://sales-ai-agent-sfn2.onrender.com/invoice";

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

    // 1. Close any legacy native side pane if opened previously
    InvoiceAIAgent.closeNativeSidePane();

    // 2. Inject or show floating button & popup drawer for Invoice/Quote
    InvoiceAIAgent.initUI();

    // 3. Start navigation watcher to clean up only when user leaves Invoice/Quote
    InvoiceAIAgent.startNavigationWatcher();
  } catch (err) {
    console.error("Error in InvoiceAIAgent.onLoad:", err);
  }
};

/**
 * Check if the active screen is an Invoice or Quote
 */
InvoiceAIAgent.isInvoiceOrQuoteActive = function () {
  try {
    var topWin = window.top || window;
    var href = (topWin.location && topWin.location.href) || "";

    // If URL contains etn=invoice or etn=quote, it's active!
    if (href.indexOf("etn=invoice") !== -1 || href.indexOf("etn=quote") !== -1) {
      return true;
    }

    // Check CRM formContext
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (window.top && window.top.Xrm);
    var fc = InvoiceAIAgent.currentFormContext || (xrm && xrm.Page);
    if (fc && fc.data && fc.data.entity) {
      var ent = fc.data.entity.getEntityName();
      return ent === "invoice" || ent === "quote";
    }

    return true; // Default to true to prevent accidental removal
  } catch (e) {
    return true;
  }
};

/**
 * Clean up / Remove button and drawer from screen
 */
InvoiceAIAgent.cleanup = function () {
  try {
    var targetDoc = window.top.document || document;
    var fab = targetDoc.getElementById("d365-invoice-ai-fab");
    if (fab && fab.parentNode) {
      fab.parentNode.removeChild(fab);
    }
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    if (drawer && drawer.parentNode) {
      drawer.parentNode.removeChild(drawer);
    }
  } catch (e) {}
};

/**
 * Navigation Watcher: Monitors when user leaves Invoice / Quote entity
 */
InvoiceAIAgent.startNavigationWatcher = function () {
  try {
    if (InvoiceAIAgent.watcherInterval) {
      clearInterval(InvoiceAIAgent.watcherInterval);
    }

    InvoiceAIAgent.watcherInterval = setInterval(function () {
      try {
        if (!InvoiceAIAgent.isInvoiceOrQuoteActive()) {
          // User navigated away to Leads, Contacts, etc. -> Cleanup!
          InvoiceAIAgent.cleanup();
          clearInterval(InvoiceAIAgent.watcherInterval);
          InvoiceAIAgent.watcherInterval = null;
        }
      } catch (ex) {}
    }, 600);

    // Also attach to window unload
    window.addEventListener("beforeunload", InvoiceAIAgent.cleanup);
    window.addEventListener("unload", InvoiceAIAgent.cleanup);
  } catch (e) {}
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
  } catch (e) {}
};

/**
 * Extract active Invoice / Quote context from form
 */
InvoiceAIAgent.getContext = function () {
  var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (window.top && window.top.Xrm);
  var recordId = "";
  var recordName = "";
  var customerName = "";
  var totalAmount = "";
  var entityName = "invoice";

  try {
    var fc = InvoiceAIAgent.currentFormContext || (xrm && xrm.Page && xrm.Page.data ? xrm.Page : null);
    if (fc && fc.data && fc.data.entity) {
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
  } catch (e) {}

  return {
    recordId: recordId,
    recordName: recordName,
    customerName: customerName,
    totalAmount: totalAmount,
    entityName: entityName
  };
};

/**
 * Toggle the Floating Drawer (100% Reliable, Direct State)
 */
InvoiceAIAgent.toggleDrawer = function () {
  try {
    var targetDoc = window.top.document || document;
    var drawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    var fab = targetDoc.getElementById("d365-invoice-ai-fab");
    if (!drawer) return;

    var isCurrentlyOpen = (drawer.style.display === "flex" && drawer.style.opacity !== "0");

    if (!isCurrentlyOpen) {
      // ── OPEN DRAWER ──
      var ctx = InvoiceAIAgent.getContext();
      var frame = targetDoc.getElementById("d365-invoice-ai-frame");
      var targetUrl = InvoiceAIAgent.WIDGET_URL + 
                      "?id=" + encodeURIComponent(ctx.recordId) +
                      "&name=" + encodeURIComponent(ctx.recordName) +
                      "&customer=" + encodeURIComponent(ctx.customerName) +
                      "&total=" + encodeURIComponent(ctx.totalAmount) +
                      "&type=" + encodeURIComponent(ctx.entityName);

      if (frame && (!frame.src || frame.src === "about:blank" || !frame.src.includes(ctx.recordId))) {
        frame.src = targetUrl;
      }

      drawer.style.display = "flex";
      drawer.style.pointerEvents = "auto";
      drawer.style.opacity = "1";
      drawer.style.transform = "translateY(0) scale(1)";

      // Transform FAB icon to Close (✕)
      if (fab) {
        fab.innerHTML = `
          <svg style="pointer-events:none;" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
        fab.title = "Close Invoice AI Agent";
      }
    } else {
      // ── CLOSE DRAWER ──
      drawer.style.opacity = "0";
      drawer.style.transform = "translateY(16px) scale(0.96)";
      drawer.style.pointerEvents = "none";
      drawer.style.display = "none";

      // Restore FAB icon to Sparkle (✨)
      if (fab) {
        fab.innerHTML = `
          <svg style="pointer-events:none;" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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

/**
 * Initialize Floating Button and Floating Card UI
 */
InvoiceAIAgent.initUI = function () {
  try {
    var targetDoc = window.top.document || document;

    var existingFab = targetDoc.getElementById("d365-invoice-ai-fab");
    var existingDrawer = targetDoc.getElementById("d365-invoice-ai-drawer");

    // If elements already exist, ensure they are visible
    if (existingFab && existingDrawer) {
      existingFab.style.display = "flex";
      return;
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

    // Apply Styles (Emerald / Teal gradient matching Invoice theme)
    Object.assign(fab.style, {
      position: "fixed",
      bottom: "26px",
      right: "26px",
      width: "54px",
      height: "54px",
      borderRadius: "50%",
      background: "linear-gradient(135deg, #0d9488 0%, #10b981 50%, #059669 100%)",
      boxShadow: "0 6px 20px rgba(16, 185, 129, 0.45), 0 2px 6px rgba(0,0,0,0.18)",
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
      fab.style.boxShadow = "0 10px 28px rgba(16, 185, 129, 0.55), 0 4px 10px rgba(0,0,0,0.22)";
    };
    fab.onmouseleave = function () {
      fab.style.transform = "scale(1) translateY(0px)";
      fab.style.boxShadow = "0 6px 20px rgba(16, 185, 129, 0.45), 0 2px 6px rgba(0,0,0,0.18)";
    };
    fab.onmousedown = function () {
      fab.style.transform = "scale(0.95)";
    };
    fab.onmouseup = function () {
      fab.style.transform = "scale(1.1) translateY(-2px)";
    };

    fab.onclick = function (e) {
      e.stopPropagation();
      InvoiceAIAgent.toggleDrawer();
    };

    // 2. Create Floating Drawer Container
    var drawer = targetDoc.createElement("div");
    drawer.id = "d365-invoice-ai-drawer";
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
      boxShadow: "0 14px 44px rgba(15, 23, 42, 0.25), 0 4px 14px rgba(16, 185, 129, 0.15)",
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

// Auto-run if script is evaluated
if (typeof window !== "undefined") {
  InvoiceAIAgent.closeNativeSidePane();
  InvoiceAIAgent.initUI();
}
