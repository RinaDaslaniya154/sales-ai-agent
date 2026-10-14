/**
 * Dynamics 365 Floating Action Button (FAB) for Invoice AI Agent
 * - Adds a floating ✨ button at the bottom-right corner (like Copilot / Account AI Agent)
 * - Click once -> Opens Invoice AI Agent in Dynamics 365 Side Pane
 * - Click again -> Closes the Side Pane (Toggle Mode)
 */

var InvoiceAIAgent = window.InvoiceAIAgent || {};

InvoiceAIAgent.PANE_ID = "InvoiceAIAgentSidePane";
// Replace with your Web Resource name OR Cloudflare Tunnel URL
InvoiceAIAgent.WIDGET_URL = "https://tongue-regression-matters-part.trycloudflare.com/invoice";

/**
 * Toggle Side Pane: Open if closed, Close if opened
 */
InvoiceAIAgent.toggleSidePane = function () {
  try {
    var xrm = window.Xrm || (window.parent && window.parent.Xrm) || (window.top && window.top.Xrm);
    if (!xrm || !xrm.App || !xrm.App.sidePanes) {
      console.error("Xrm.App.sidePanes is not available.");
      return;
    }

    var pane = xrm.App.sidePanes.getPane(InvoiceAIAgent.PANE_ID);

    if (pane) {
      // 1. If pane is already OPEN -> CLOSE IT!
      pane.close();
      console.log("Invoice AI Agent side pane closed.");
    } else {
      // 2. If pane is CLOSED -> OPEN IT!
      xrm.App.sidePanes.createPane({
        title: "Invoice AI Agent",
        paneId: InvoiceAIAgent.PANE_ID,
        canClose: true,
        width: 480
      }).then(function (newPane) {
        // Navigate inside side pane
        newPane.navigate({
          pageType: "webresource",
          webresourceName: "new_invoicewidget", // Or use custom webresource name
          data: encodeURIComponent("url=" + InvoiceAIAgent.WIDGET_URL)
        });
        console.log("Invoice AI Agent side pane opened.");
      }).catch(function (err) {
        console.error("Error opening side pane:", err);
      });
    }
  } catch (ex) {
    console.error("Error in InvoiceAIAgent.toggleSidePane:", ex);
  }
};

/**
 * Inject Floating Action Button (FAB) into the bottom-right corner
 */
InvoiceAIAgent.injectFabButton = function () {
  try {
    var targetDoc = window.top.document || document;

    // Check if button already exists to avoid duplicates
    if (targetDoc.getElementById("d365-invoice-ai-fab")) {
      return;
    }

    // Create Button Element
    var fab = targetDoc.createElement("div");
    fab.id = "d365-invoice-ai-fab";
    fab.title = "Invoice AI Agent";
    fab.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" fill="white"/>
        <path d="M19 16L19.9 19.1L23 20L19.9 20.9L19 24L18.1 20.9L15 20L18.1 19.1L19 16Z" fill="#FDE047"/>
      </svg>
    `;

    // Apply Styles (Floating circle at bottom-right, smooth animation)
    Object.assign(fab.style, {
      position: "fixed",
      bottom: "26px",
      right: "26px",
      width: "52px",
      height: "52px",
      borderRadius: "50%",
      background: "linear-gradient(135deg, #0d9488 0%, #10b981 50%, #059669 100%)", // Emerald / Teal like image 1
      boxShadow: "0 4px 16px rgba(16, 185, 129, 0.4), 0 2px 6px rgba(0,0,0,0.15)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      zIndex: "999999",
      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      userSelect: "none"
    });

    // Hover & Click animations
    fab.onmouseenter = function () {
      fab.style.transform = "scale(1.1) translateY(-2px)";
      fab.style.boxShadow = "0 8px 24px rgba(16, 185, 129, 0.5), 0 4px 10px rgba(0,0,0,0.2)";
    };
    fab.onmouseleave = function () {
      fab.style.transform = "scale(1) translateY(0px)";
      fab.style.boxShadow = "0 4px 16px rgba(16, 185, 129, 0.4), 0 2px 6px rgba(0,0,0,0.15)";
    };
    fab.onmousedown = function () {
      fab.style.transform = "scale(0.95)";
    };
    fab.onmouseup = function () {
      fab.style.transform = "scale(1.1) translateY(-2px)";
    };

    // Toggle on Click
    fab.onclick = function (e) {
      e.stopPropagation();
      InvoiceAIAgent.toggleSidePane();
    };

    targetDoc.body.appendChild(fab);
    console.log("Invoice AI Agent FAB button injected successfully.");
  } catch (err) {
    console.error("Failed to inject FAB button:", err);
  }
};

// Initialize when loaded
if (typeof window !== "undefined") {
  // If called via Ribbon EnableRule or Form OnLoad
  InvoiceAIAgent.injectFabButton();
}
