/**
 * Dynamics 365 Floating Action Button (FAB) & Floating Drawer for Sales AI Agent
 * - Single modern Floating Action Button (✨) at bottom-right
 * - Click once -> Smoothly opens the Sales AI Agent Floating Drawer
 * - Click again or click Close (✕) -> Closes the Drawer
 * - Fully supports Standard Form View & Split Screen / Focused View (pagetype=entitylist or entityrecord)
 * - LIVE RE-BINDING: Re-binds click handlers on every lead click in Focused View to prevent dead buttons
 * - AUTO-REFRESH CONTEXT: When switching leads with drawer open, dynamically reloads drawer with current lead
 * - AUTO-CLEANUP: Removes button when user leaves Lead (navigates to Quotes, Invoices, Accounts, etc.)
 * - AUTO-PURGE: Cleans up any leftover Invoice UI from the screen
 */

var topWin = (typeof window !== "undefined" && window.top) ? window.top : (typeof window !== "undefined" ? window : globalThis);
var SalesAIAgent = topWin.__SalesAIAgent || window.SalesAIAgent || {};
topWin.__SalesAIAgent = SalesAIAgent;
if (typeof window !== "undefined") {
  window.SalesAIAgent = SalesAIAgent;
}

// Active Cloudflare Tunnel Live URL for Sales AI Agent Widget (Superfast Local Server)
SalesAIAgent.WIDGET_URL = "https://trio-weblogs-medicare-scout.trycloudflare.com/widget";

SalesAIAgent.currentFormContext = null;

/**
 * Dynamics 365 Form OnLoad Event Handler
 */
SalesAIAgent.onLoad = function (executionContext) {
  try {
    if (executionContext && executionContext.getFormContext) {
      SalesAIAgent.currentFormContext = executionContext.getFormContext();
      topWin.__currentLeadFormContext = SalesAIAgent.currentFormContext;
    }

    // 1. Instantly remove any leftover Invoice AI UI if present
    SalesAIAgent.purgeInvoiceUI();

    // 2. Check if we are active on Lead
    if (!SalesAIAgent.isLeadActive()) {
      SalesAIAgent.cleanup();
      return;
    }

    // 3. Close legacy native side pane if opened previously
    SalesAIAgent.closeNativeSidePane();

    // 4. Inject or re-bind floating button & popup drawer for Lead
    SalesAIAgent.initUI();

    // 5. If drawer is currently open, dynamically update iframe with this new lead!
    var targetDoc = topWin.document || document;
    var drawer = targetDoc.getElementById("d365-sales-ai-drawer");
    if (drawer && drawer.getAttribute("data-open") === "true") {
      SalesAIAgent.refreshDrawerContext();
    }

    // 6. Start top-level navigation watcher
    SalesAIAgent.startNavigationWatcher();
  } catch (err) {
    console.error("Error in SalesAIAgent.onLoad:", err);
  }
};

/**
 * Instantly purge any Invoice AI UI lingering on screen
 */
SalesAIAgent.purgeInvoiceUI = function () {
  try {
    var targetDoc = topWin.document || document;
    var oldInvoiceFab = targetDoc.getElementById("d365-invoice-ai-fab");
    var oldInvoiceDrawer = targetDoc.getElementById("d365-invoice-ai-drawer");
    if (oldInvoiceFab && oldInvoiceFab.parentNode) oldInvoiceFab.parentNode.removeChild(oldInvoiceFab);
    if (oldInvoiceDrawer && oldInvoiceDrawer.parentNode) oldInvoiceDrawer.parentNode.removeChild(oldInvoiceDrawer);
  } catch (e) { }
};

/**
 * Check if the active screen is still a Lead
 */
SalesAIAgent.isLeadActive = function () {
  try {
    var href = (topWin.location && topWin.location.href) || "";

    // If URL explicitly points to another entity like Quotes or Invoices, then user left Lead!
    if (href.indexOf("etn=quote") !== -1 || href.indexOf("etn=invoice") !== -1 || href.indexOf("etn=account") !== -1) {
      return false;
    }

    // If URL contains etn=lead, Lead is definitely active (both full form and focused view)
    if (href.indexOf("etn=lead") !== -1) {
      return true;
    }

    // Check CRM formContext
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (topWin && topWin.Xrm);
    var fc = SalesAIAgent.currentFormContext || topWin.__currentLeadFormContext || (xrm && xrm.Page);
    if (fc && fc.data && fc.data.entity) {
      return fc.data.entity.getEntityName() === "lead";
    }

    return true; // Default to true to prevent accidental removal
  } catch (e) {
    return true;
  }
};

/**
 * Clean up / Remove button and drawer from screen
 */
SalesAIAgent.cleanup = function () {
  try {
    var targetDoc = topWin.document || document;
    var fab = targetDoc.getElementById("d365-sales-ai-fab");
    if (fab && fab.parentNode) {
      fab.parentNode.removeChild(fab);
    }
    var drawer = targetDoc.getElementById("d365-sales-ai-drawer");
    if (drawer && drawer.parentNode) {
      drawer.parentNode.removeChild(drawer);
    }
    if (topWin.__d365SalesWatcher) {
      topWin.clearInterval(topWin.__d365SalesWatcher);
      topWin.__d365SalesWatcher = null;
    }
  } catch (e) { }
};

/**
 * Top-level Navigation Watcher: Monitors when user leaves Lead entity
 */
SalesAIAgent.startNavigationWatcher = function () {
  try {
    topWin.__d365SalesCleanup = SalesAIAgent.cleanup;
    topWin.__isLeadStillActive = SalesAIAgent.isLeadActive;

    if (topWin.__d365SalesWatcher) {
      topWin.clearInterval(topWin.__d365SalesWatcher);
    }

    topWin.__d365SalesWatcher = topWin.setInterval(function () {
      try {
        if (!SalesAIAgent.isLeadActive()) {
          SalesAIAgent.cleanup();
          topWin.clearInterval(topWin.__d365SalesWatcher);
          topWin.__d365SalesWatcher = null;
        }
      } catch (ex) { }
    }, 400);

    // Hook into Dynamics 365 History navigation for instant cleanup when navigating away
    if (!topWin.__d365SalesNavHooked) {
      topWin.__d365SalesNavHooked = true;
      var origPush = topWin.history.pushState;
      topWin.history.pushState = function () {
        var ret = origPush.apply(this, arguments);
        try {
          if (!SalesAIAgent.isLeadActive()) SalesAIAgent.cleanup();
        } catch (e) { }
        return ret;
      };

      var origReplace = topWin.history.replaceState;
      topWin.history.replaceState = function () {
        var ret = origReplace.apply(this, arguments);
        try {
          if (!SalesAIAgent.isLeadActive()) SalesAIAgent.cleanup();
        } catch (e) { }
        return ret;
      };

      topWin.addEventListener("popstate", function () {
        if (!SalesAIAgent.isLeadActive()) SalesAIAgent.cleanup();
      });
      topWin.addEventListener("hashchange", function () {
        if (!SalesAIAgent.isLeadActive()) SalesAIAgent.cleanup();
      });
    }
  } catch (e) { }
};

/**
 * Close any old native side pane to remove the right-rail icon
 */
SalesAIAgent.closeNativeSidePane = function () {
  try {
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (topWin && topWin.Xrm);
    if (xrm && xrm.App && xrm.App.sidePanes) {
      var pane = xrm.App.sidePanes.getPane("SalesAIAgentSidePane");
      if (pane) pane.close();
    }
  } catch (e) { }
};

/**
 * Extract active Lead context (ID, Full Name, Company) from form
 */
SalesAIAgent.getLeadContext = function () {
  var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (topWin && topWin.Xrm);
  var leadId = "";
  var leadName = "";
  var company = "";

  try {
    var fc = SalesAIAgent.currentFormContext ||
             topWin.__currentLeadFormContext ||
             (xrm && xrm.Page && xrm.Page.data ? xrm.Page : null);

    if (fc && fc.data && fc.data.entity) {
      var rawId = fc.data.entity.getId();
      if (rawId) leadId = rawId.replace(/[{}]/g, "");

      var nameAttr = fc.getAttribute("fullname") || fc.getAttribute("subject");
      if (nameAttr && nameAttr.getValue()) leadName = nameAttr.getValue();

      var compAttr = fc.getAttribute("companyname");
      if (compAttr && compAttr.getValue()) company = compAttr.getValue();
    }

    // Fallback: check UCI page context if not found
    if (!leadId && xrm && xrm.Utility && xrm.Utility.getPageContext) {
      var pageCtx = xrm.Utility.getPageContext();
      if (pageCtx && pageCtx.input && pageCtx.input.entityId) {
        leadId = pageCtx.input.entityId.replace(/[{}]/g, "");
      }
    }
  } catch (ex) {
    console.warn("Could not extract lead context:", ex);
  }

  return { leadId: leadId, leadName: leadName, company: company };
};

/**
 * Refresh the drawer's iframe src with current Lead context
 */
SalesAIAgent.refreshDrawerContext = function () {
  try {
    var targetDoc = topWin.document || document;
    var frame = targetDoc.getElementById("d365-sales-ai-frame");
    if (!frame) return;

    var ctx = SalesAIAgent.getLeadContext();
    var targetUrl = SalesAIAgent.WIDGET_URL +
      "?id=" + encodeURIComponent(ctx.leadId) +
      "&leadname=" + encodeURIComponent(ctx.leadName) +
      "&company=" + encodeURIComponent(ctx.company);

    if (frame.src !== targetUrl && (!frame.src.includes(ctx.leadId) || !ctx.leadId)) {
      frame.src = targetUrl;
    }
  } catch (e) {
    console.error("Error in refreshDrawerContext:", e);
  }
};

/**
 * Toggle the Floating Drawer
 */
SalesAIAgent.toggleDrawer = function () {
  try {
    var targetDoc = topWin.document || document;
    var drawer = targetDoc.getElementById("d365-sales-ai-drawer");
    var fab = targetDoc.getElementById("d365-sales-ai-fab");
    if (!drawer) return;

    var isCurrentlyOpen = (drawer.getAttribute("data-open") === "true");
    var willOpen = !isCurrentlyOpen;
    drawer.setAttribute("data-open", willOpen ? "true" : "false");

    if (willOpen) {
      // 1. Ensure iframe points to the current active lead
      SalesAIAgent.refreshDrawerContext();

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
        fab.title = "Close Sales AI Agent";
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
        fab.title = "Sales AI Agent";
      }
    }
  } catch (e) {
    console.error("Error in toggleDrawer:", e);
  }
};

/**
 * Initialize Floating Button and Floating Card UI
 */
SalesAIAgent.initUI = function () {
  try {
    var targetDoc = topWin.document || document;

    var existingFab = targetDoc.getElementById("d365-sales-ai-fab");
    var existingDrawer = targetDoc.getElementById("d365-sales-ai-drawer");

    // CRITICAL FIX: If elements already exist, ALWAYS RE-BIND ONCLICK to prevent dead handlers!
    if (existingFab && existingDrawer) {
      existingFab.style.display = "flex";

      // Re-bind fresh click handler on existing FAB
      existingFab.onclick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var agent = topWin.__SalesAIAgent || SalesAIAgent;
        agent.toggleDrawer();
      };

      // Also ensure hover effects work properly
      existingFab.onmouseenter = function () {
        existingFab.style.transform = "scale(1.1) translateY(-2px)";
      };
      existingFab.onmouseleave = function () {
        existingFab.style.transform = "scale(1) translateY(0px)";
      };

      return;
    }

    // 1. Create Floating Action Button (FAB)
    var fab = targetDoc.createElement("div");
    fab.id = "d365-sales-ai-fab";
    fab.title = "Sales AI Agent";
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
      var agent = topWin.__SalesAIAgent || SalesAIAgent;
      agent.toggleDrawer();
    };

    // 2. Create Floating Drawer Container
    var drawer = targetDoc.createElement("div");
    drawer.id = "d365-sales-ai-drawer";
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
    iframe.id = "d365-sales-ai-frame";
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

    console.log("Sales AI Agent Modern Floating Drawer initialized for Lead.");
  } catch (err) {
    console.error("Failed to initialize Sales AI UI:", err);
  }
};

// Auto-run if script is evaluated
if (typeof window !== "undefined") {
  SalesAIAgent.closeNativeSidePane();
  SalesAIAgent.purgeInvoiceUI();
  if (SalesAIAgent.isLeadActive()) {
    SalesAIAgent.initUI();
    SalesAIAgent.startNavigationWatcher();
  } else {
    SalesAIAgent.cleanup();
  }
}
