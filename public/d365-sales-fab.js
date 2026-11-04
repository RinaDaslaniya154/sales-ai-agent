/**
 * Dynamics 365 Top-Bar Copilot Neighbor & Floating UI for Sales AI Agent
 * - Injects a native-styled "Sales AI" button in Dynamics 365 top navigation bar right next to Copilot!
 * - Click on Top-Bar button -> Opens a Copilot-Style Full-Height Docked Side Pane (squeezes CRM page)
 * - Also provides the modern Floating Action Button (FAB ✨) at bottom-right
 * - Fully supports Standard Form View & Split Screen / Focused View (pagetype=entitylist or entityrecord)
 * - LIVE RE-BINDING & AUTO-REFRESH CONTEXT: Passes active lead data dynamically
 * - AUTO-CLEANUP: Seamlessly removes elements when navigating away
 * - AUTO-PURGE: Cleans up any leftover Invoice UI from the screen
 */

var topWin = (typeof window !== "undefined" && window.top) ? window.top : (typeof window !== "undefined" ? window : globalThis);
var SalesAIAgent = topWin.__SalesAIAgent || window.SalesAIAgent || {};
topWin.__SalesAIAgent = SalesAIAgent;
if (typeof window !== "undefined") {
  window.SalesAIAgent = SalesAIAgent;
}

// Active Cloudflare Tunnel Live URLs
SalesAIAgent.BASE_TUNNEL_URL = "https://proven-grows-communist-households.trycloudflare.com";
SalesAIAgent.SALES_AGENT_URL = "https://proven-grows-communist-households.trycloudflare.com/widget";
SalesAIAgent.INVOICE_AGENT_URL = "https://proven-grows-communist-households.trycloudflare.com/invoice";
SalesAIAgent.WIDGET_URL = SalesAIAgent.SALES_AGENT_URL;

SalesAIAgent.currentFormContext = null;

// ⚡ Global Message & Click Listeners (Close handlers & navigation)
if (topWin && !topWin.__d365SalesMsgListenerAttached) {
  topWin.__d365SalesMsgListenerAttached = true;

  // Listen for close commands from iframe widget
  topWin.addEventListener("message", function (event) {
    if (!event || !event.data) return;
    if (event.data.action === "close_d365_sales_sidepane" || 
        event.data === "close_d365_sales_sidepane" ||
        event.data.action === "close_d365_sidepane" ||
        event.data === "close_d365_sidepane") {
      var agent = topWin.__SalesAIAgent || SalesAIAgent;
      if (agent && agent.closeSidePane) agent.closeSidePane();
    }
  });

  // Global Capturing Click Interceptor: Closes sidepane when top-right X is clicked
  topWin.document.addEventListener("click", function (e) {
    try {
      var target = e.target;
      var btn = target && (target.closest ? target.closest('button, [role="button"]') : null);
      if (btn) {
        var rect = btn.getBoundingClientRect();
        var isTopRight = (rect.right > (topWin.innerWidth - 140)) && (rect.top < 120);
        var btnText = (btn.innerText || "").trim();
        var aria = (btn.getAttribute("aria-label") || btn.getAttribute("title") || btn.getAttribute("data-id") || "").toLowerCase();
        var isCloseButton = aria.indexOf("close") !== -1 || btnText === "✕" || btnText === "×" || btnText === "X";

        if (isTopRight && isCloseButton) {
          var agent = topWin.__SalesAIAgent || SalesAIAgent;
          if (agent && agent.closeSidePane) agent.closeSidePane();
        }
      }
    } catch (ex) { }
  }, true);
}

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

    // 4. Inject Top-Bar button next to Microsoft Copilot!
    SalesAIAgent.injectTopBarButton();

    // 5. Inject floating button & popup drawer for Lead
    SalesAIAgent.initUI();

    // 6. If drawer or sidepane is currently open, dynamically update iframe with this new lead!
    SalesAIAgent.refreshActiveContext();

    // 7. Start top-level navigation watcher
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
    var oldInvoicePane = targetDoc.getElementById("d365-invoice-ai-sidepane");
    var oldInvoiceTopBtn = targetDoc.getElementById("d365-topbar-invoice-ai-btn");
    if (oldInvoiceFab && oldInvoiceFab.parentNode) oldInvoiceFab.parentNode.removeChild(oldInvoiceFab);
    if (oldInvoiceDrawer && oldInvoiceDrawer.parentNode) oldInvoiceDrawer.parentNode.removeChild(oldInvoiceDrawer);
    if (oldInvoicePane && oldInvoicePane.parentNode) oldInvoicePane.parentNode.removeChild(oldInvoicePane);
    if (oldInvoiceTopBtn && oldInvoiceTopBtn.parentNode) oldInvoiceTopBtn.parentNode.removeChild(oldInvoiceTopBtn);
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
    if (fab && fab.parentNode) fab.parentNode.removeChild(fab);

    var drawer = targetDoc.getElementById("d365-sales-ai-drawer");
    if (drawer && drawer.parentNode) drawer.parentNode.removeChild(drawer);

    var topBtn = targetDoc.getElementById("d365-topbar-sales-ai-btn");
    if (topBtn && topBtn.parentNode) topBtn.parentNode.removeChild(topBtn);

    SalesAIAgent.closeSidePane();

    if (topWin.__d365SalesWatcher) {
      topWin.clearInterval(topWin.__d365SalesWatcher);
      topWin.__d365SalesWatcher = null;
    }
  } catch (e) { }
};

/**
 * Top-level Navigation Watcher: Keeps elements alive & cleans up when leaving Lead
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
          return;
        }

        // Keep Top-Bar button alive next to Copilot across view switches
        var targetDoc = topWin.document || document;
        var topBtn = targetDoc.getElementById("d365-topbar-sales-ai-btn");
        if (!topBtn) {
          SalesAIAgent.injectTopBarButton();
        }

        // Keep FAB alive if Lead is active
        var fab = targetDoc.getElementById("d365-sales-ai-fab");
        if (!fab) {
          SalesAIAgent.initUI();
        }

        // Auto-refresh active Lead context if open
        SalesAIAgent.refreshActiveContext();
      } catch (ex) { }
    }, 600);

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
 * Build target URL with active Lead query params
 */
SalesAIAgent.getTargetUrl = function () {
  var ctx = SalesAIAgent.getLeadContext();
  var targetUrl = SalesAIAgent.WIDGET_URL;
  if (ctx.leadId) {
    targetUrl += "?id=" + encodeURIComponent(ctx.leadId) +
      "&leadname=" + encodeURIComponent(ctx.leadName || "") +
      "&company=" + encodeURIComponent(ctx.company || "");
  }
  return targetUrl;
};

/**
 * Dynamically synchronize iframe context when user switches leads
 */
SalesAIAgent.refreshActiveContext = function () {
  try {
    var targetDoc = topWin.document || document;
    var ctx = SalesAIAgent.getLeadContext();
    var targetUrl = SalesAIAgent.getTargetUrl();

    // Check Drawer frame
    var drawer = targetDoc.getElementById("d365-sales-ai-drawer");
    var drawerFrame = targetDoc.getElementById("d365-sales-ai-frame");
    if (drawer && drawer.getAttribute("data-open") === "true" && drawerFrame) {
      if (drawerFrame.src !== targetUrl && (!drawerFrame.src.includes(ctx.leadId) || !ctx.leadId)) {
        drawerFrame.src = targetUrl;
      }
    }

    // Check Sidepane frame
    var sidePane = targetDoc.getElementById("d365-sales-ai-sidepane");
    var sideFrame = targetDoc.getElementById("d365-sales-sidepane-frame");
    if (sidePane && sidePane.getAttribute("data-open") === "true" && sideFrame) {
      if (sideFrame.src !== targetUrl && (!sideFrame.src.includes(ctx.leadId) || !ctx.leadId)) {
        sideFrame.src = targetUrl;
      }
    }
  } catch (e) { }
};

SalesAIAgent.refreshDrawerContext = SalesAIAgent.refreshActiveContext;

/**
 * 🎯 INJECT TOP-BAR BUTTON NEXT TO MICROSOFT COPILOT
 * Finds Dynamics 365 Copilot button and mounts "Sales AI" right next to it!
 */
SalesAIAgent.injectTopBarButton = function () {
  try {
    var targetDoc = topWin.document || document;

    // Avoid duplicate buttons
    var existingBtn = targetDoc.getElementById("d365-topbar-sales-ai-btn");
    if (existingBtn) {
      existingBtn.style.display = "inline-flex";
      existingBtn.onclick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var agent = topWin.__SalesAIAgent || SalesAIAgent;
        agent.toggleSidePane();
      };
      return;
    }

    // 1. Locate Dynamics 365 Header Bar or Banner
    var headerBar = targetDoc.getElementById("headerBar") ||
      targetDoc.querySelector('[data-id="topBar"]') ||
      targetDoc.querySelector('header[role="banner"]') ||
      targetDoc.querySelector('.ms-Nav') ||
      targetDoc.querySelector('div[aria-label="App header"]') ||
      targetDoc.querySelector('#main-header');

    // 2. Find Microsoft Copilot Button
    var copilotBtn = null;
    var candidates = (headerBar || targetDoc).querySelectorAll('button, div[role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var aria = (el.getAttribute("aria-label") || "").toLowerCase();
      var dataId = (el.getAttribute("data-id") || "").toLowerCase();
      var title = (el.getAttribute("title") || "").toLowerCase();
      var txt = (el.innerText || el.textContent || "").toLowerCase();

      if (aria.indexOf("copilot") !== -1 || 
          dataId.indexOf("copilot") !== -1 || 
          title.indexOf("copilot") !== -1 || 
          txt.indexOf("copilot") !== -1) {
        copilotBtn = el;
        break;
      }
    }

    // Fallback: If Copilot button isn't visible, attach near the right-hand controls
    var parentContainer = null;
    var referenceNode = null;

    if (copilotBtn && copilotBtn.parentNode) {
      parentContainer = copilotBtn.parentNode;
      referenceNode = copilotBtn; // Mount right before Copilot (to its left!)
    } else if (headerBar) {
      var rightContainers = headerBar.querySelectorAll('div, ul');
      for (var j = rightContainers.length - 1; j >= 0; j--) {
        if (rightContainers[j].querySelector('button')) {
          parentContainer = rightContainers[j];
          referenceNode = parentContainer.firstChild;
          break;
        }
      }
      if (!parentContainer) {
        parentContainer = headerBar;
        referenceNode = headerBar.lastChild;
      }
    }

    if (!parentContainer) return;

    // 3. Create the "Sales AI" Header Pill Button
    var aiBtn = targetDoc.createElement("button");
    aiBtn.id = "d365-topbar-sales-ai-btn";
    aiBtn.type = "button";
    aiBtn.setAttribute("aria-label", "Sales AI Agent");
    aiBtn.title = "Open Sales AI Agent (Copilot Assistant)";

    // Modern Copilot-matching layout: Glowing Sparkle Icon + "Sales AI"
    aiBtn.innerHTML = `
      <span style="display:inline-flex;align-items:center;justify-content:center;margin-right:6px;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L14.2 8.3L20.5 10.5L14.2 12.7L12 19L9.8 12.7L3.5 10.5L9.8 8.3L12 2Z" fill="#FACC15"/>
          <path d="M19 16L20 18.8L22.8 19.8L20 20.8L19 23.5L18 20.8L15.2 19.8L18 18.8L19 16Z" fill="#FFFFFF"/>
          <circle cx="5" cy="18" r="2.2" fill="#38BDF8"/>
        </svg>
      </span>
      <span style="font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.2px;color:#ffffff;line-height:1;">
        Sales AI
      </span>
    `;

    // Exact matching styles with Dynamics 365 top navigation bar
    Object.assign(aiBtn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      height: "32px",
      padding: "0 12px",
      marginRight: "8px",
      borderRadius: "16px",
      background: "linear-gradient(135deg, rgba(99, 102, 241, 0.40) 0%, rgba(168, 85, 247, 0.40) 100%)",
      border: "1px solid rgba(255, 255, 255, 0.35)",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
      color: "#ffffff",
      cursor: "pointer",
      outline: "none",
      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      zIndex: "9999",
      verticalAlign: "middle",
      userSelect: "none"
    });

    aiBtn.onmouseenter = function () {
      aiBtn.style.background = "linear-gradient(135deg, rgba(99, 102, 241, 0.70) 0%, rgba(168, 85, 247, 0.70) 100%)";
      aiBtn.style.borderColor = "#ffffff";
      aiBtn.style.transform = "translateY(-1px)";
      aiBtn.style.boxShadow = "0 4px 14px rgba(99, 102, 241, 0.45)";
    };
    aiBtn.onmouseleave = function () {
      aiBtn.style.background = "linear-gradient(135deg, rgba(99, 102, 241, 0.40) 0%, rgba(168, 85, 247, 0.40) 100%)";
      aiBtn.style.borderColor = "rgba(255, 255, 255, 0.35)";
      aiBtn.style.transform = "translateY(0px)";
      aiBtn.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.15)";
    };
    aiBtn.onmousedown = function () {
      aiBtn.style.transform = "scale(0.96)";
    };
    aiBtn.onmouseup = function () {
      aiBtn.style.transform = "translateY(-1px)";
    };

    // Click handler -> Toggles Copilot-style Side Pane
    aiBtn.onclick = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      var agent = topWin.__SalesAIAgent || SalesAIAgent;
      agent.toggleSidePane();
    };

    // Insert right next to Copilot!
    if (referenceNode) {
      parentContainer.insertBefore(aiBtn, referenceNode);
    } else {
      parentContainer.appendChild(aiBtn);
    }

    console.log("Sales AI Agent Top-Bar button successfully injected next to Copilot!");
  } catch (err) {
    console.warn("Failed to inject Top Bar button:", err);
  }
};

/**
 * 🚀 SQUEEZE PAGE & TOGGLE COPILOT-STYLE DOCKED SIDE PANE
 * Opens a full-height right-side pane (440px) and pushes Dynamics 365 main content to the left
 */
SalesAIAgent.toggleSidePane = function () {
  try {
    var targetDoc = topWin.document || document;
    var sidePane = targetDoc.getElementById("d365-sales-ai-sidepane");

    // Squeeze Dynamics 365 main page to the left (matching native Copilot behavior)
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
    topWin.__d365SalesSqueezePage = squeezePage;

    // If sidepane is currently open, smoothly close it
    if (sidePane && sidePane.getAttribute("data-open") === "true") {
      SalesAIAgent.closeSidePane();
      return;
    }

    var targetUrl = SalesAIAgent.getTargetUrl();

    if (!sidePane) {
      sidePane = targetDoc.createElement("div");
      sidePane.id = "d365-sales-ai-sidepane";
      sidePane.setAttribute("data-open", "false");
      Object.assign(sidePane.style, {
        position: "fixed",
        top: "48px",
        right: "0px",
        width: "440px",
        maxWidth: "92vw",
        height: "calc(100vh - 48px)",
        backgroundColor: "#ffffff",
        boxShadow: "-4px 0 24px rgba(15, 23, 42, 0.16)",
        borderLeft: "1px solid #e2e8f0",
        zIndex: "9999",
        display: "flex",
        flexDirection: "column",
        transition: "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        transform: "translateX(100%)",
        pointerEvents: "none"
      });

      var iframe = targetDoc.createElement("iframe");
      iframe.id = "d365-sales-sidepane-frame";
      iframe.src = targetUrl;
      iframe.allow = "clipboard-read; clipboard-write; microphone";
      Object.assign(iframe.style, {
        flex: "1",
        width: "100%",
        height: "100%",
        border: "none",
        display: "block"
      });

      sidePane.appendChild(iframe);
      targetDoc.body.appendChild(sidePane);
    } else {
      var frame = targetDoc.getElementById("d365-sales-sidepane-frame");
      var ctx = SalesAIAgent.getLeadContext();
      if (frame && (!frame.src.includes(ctx.leadId) || !ctx.leadId)) {
        frame.src = targetUrl;
      }
    }

    // Close floating drawer if open so both don't clash
    var drawer = targetDoc.getElementById("d365-sales-ai-drawer");
    if (drawer && drawer.getAttribute("data-open") === "true") {
      SalesAIAgent.toggleDrawer();
    }

    // Slide in side pane & squeeze page
    setTimeout(function () {
      sidePane.setAttribute("data-open", "true");
      sidePane.style.pointerEvents = "auto";
      sidePane.style.transform = "translateX(0)";
      squeezePage(true);
    }, 20);
  } catch (err) {
    console.error("Error in toggleSidePane:", err);
  }
};

SalesAIAgent.openSidePane = SalesAIAgent.toggleSidePane;

/**
 * Close Docked Side Pane & Restore Dynamics 365 screen width
 */
SalesAIAgent.closeSidePane = function () {
  try {
    var targetDoc = topWin.document || document;
    var sidePane = targetDoc.getElementById("d365-sales-ai-sidepane");
    if (sidePane) {
      sidePane.setAttribute("data-open", "false");
      sidePane.style.transform = "translateX(100%)";
      sidePane.style.pointerEvents = "none";
    }
    if (typeof topWin.__d365SalesSqueezePage === "function") {
      topWin.__d365SalesSqueezePage(false);
    }
  } catch (e) { }
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
      // 0. Close docked sidepane if open
      SalesAIAgent.closeSidePane();

      // 1. Ensure iframe points to the current active lead
      SalesAIAgent.refreshActiveContext();

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

    // If elements already exist, re-bind fresh click handler
    if (existingFab && existingDrawer) {
      existingFab.style.display = "flex";
      existingFab.onclick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var agent = topWin.__SalesAIAgent || SalesAIAgent;
        agent.toggleDrawer();
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
    fab.onmousedown = function () { fab.style.transform = "scale(0.95)"; };
    fab.onmouseup = function () { fab.style.transform = "scale(1.1) translateY(-2px)"; };

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

    console.log("Sales AI Agent Floating UI initialized for Lead.");
  } catch (err) {
    console.error("Failed to initialize Sales AI UI:", err);
  }
};

// Global Aliases
SalesAIAgent.openFromRibbon = SalesAIAgent.toggleSidePane;
SalesAIAgent.openSalesAI = SalesAIAgent.toggleSidePane;
SalesAIAgent.ribbonClick = SalesAIAgent.toggleSidePane;

topWin.openSalesAIAgent = SalesAIAgent.toggleSidePane;
topWin.openSalesAI = SalesAIAgent.toggleSidePane;
if (typeof window !== "undefined") {
  window.openSalesAIAgent = SalesAIAgent.toggleSidePane;
  window.openSalesAI = SalesAIAgent.toggleSidePane;
}

// Auto-run if script is loaded
if (typeof window !== "undefined") {
  SalesAIAgent.closeNativeSidePane();
  SalesAIAgent.purgeInvoiceUI();
  if (SalesAIAgent.isLeadActive()) {
    SalesAIAgent.injectTopBarButton();
    SalesAIAgent.initUI();
    SalesAIAgent.startNavigationWatcher();
  } else {
    SalesAIAgent.cleanup();
  }
}
