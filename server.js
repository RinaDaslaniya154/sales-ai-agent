const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const agentBrain = require('./agentBrain');
const dynamicsService = require('./dynamicsService');
const emailService = require('./emailService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health & System Status Endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    dynamics: dynamicsService.getStatus(),
    openai: {
      isConfigured: agentBrain.isOpenAIConfigured,
      model: agentBrain.isOpenAIConfigured ? (agentBrain.modelName || 'gemini-3.1-flash-lite') : 'Smart Rule Engine (Ready for API Key)',
    },
    serverTime: new Date().toISOString(),
  });
});

// Embeddable Widget Endpoint for Dynamics 365
app.get('/widget', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'widget.html'));
});

// Get Lead Details by GUID
app.get('/api/lead-by-id', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID is required' });
    const cleanId = id.replace(/[{}]/g, '');
    const lead = await dynamicsService.getLeadById(cleanId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lead', details: err.message });
  }
});

// Chat History Endpoints (Dynamics 365 Dataverse Notes Persistence)
app.get('/api/chat-history', async (req, res) => {
  try {
    const { leadId } = req.query;
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });
    const cleanId = leadId.replace(/[{}]/g, '');
    const result = await dynamicsService.getChatTranscript(cleanId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat history', details: err.message });
  }
});

app.post('/api/chat-history', async (req, res) => {
  try {
    const { leadId, messages } = req.body;
    if (!leadId || !messages) return res.status(400).json({ error: 'leadId and messages required' });
    const cleanId = leadId.replace(/[{}]/g, '');
    const result = await dynamicsService.saveChatTranscript(cleanId, messages);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save chat history', details: err.message });
  }
});

// Chat Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default-session', currentLeadId, currentLeadName, currentLeadCompany, currentLeadEmail, timezone } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const result = await agentBrain.processMessage(sessionId, message, {
      currentLeadId,
      currentLeadName,
      currentLeadCompany,
      currentLeadEmail,
      userTimezone: timezone || 'Asia/Kolkata',
    });

    // Auto-save to Dynamics 365 Notes if active lead ID is present
    if (currentLeadId && result.reply) {
      const cleanId = currentLeadId.replace(/[{}]/g, '');
      // Fire-and-forget background save to keep chat fast
      dynamicsService.getChatTranscript(cleanId).then(existing => {
        const history = (existing && existing.messages) ? existing.messages : [];
        history.push({ sender: 'user', text: message });
        history.push({ sender: 'ai', text: result.reply });
        dynamicsService.saveChatTranscript(cleanId, history).catch(e => console.error('Auto-save note error:', e.message));
      }).catch(e => console.error('Fetch note error:', e.message));
    }

    res.json({
      success: true,
      reply: result.reply,
      leadCreated: result.leadCreated,
      navigateToLead: result.navigateToLead || null,
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Captured Leads List
app.get('/api/leads', (req, res) => {
  res.json({
    leads: dynamicsService.getLeadsHistory(),
  });
});


// Direct Brochure PDF Download
const { generateBrochurePDF } = require('./brochureGenerator');
app.get('/api/download-brochure', async (req, res) => {
  try {
    const name = req.query.name || 'Valued Customer';
    const pdfBuffer = await generateBrochurePDF(name);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="CloudScale_Sales_AI_Product_Brochure_2026.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: 'PDF generation failed', details: err.message });
  }
});

// Custom Attachment / Quotation Upload & Email Dispatch
app.post('/api/send-email-attachment', async (req, res) => {
  try {
    const { toEmail, customerName, fileName, fileBase64, fileType, currentLeadId } = req.body;
    if (!toEmail) return res.status(400).json({ error: 'toEmail is required' });
    if (!fileBase64) return res.status(400).json({ error: 'fileBase64 is required' });

    const base64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
    const fileBuffer = Buffer.from(base64Data, 'base64');

    const result = await emailService.sendCustomAttachment(
      toEmail,
      customerName || 'Valued Customer',
      fileName || 'Quotation.pdf',
      fileBuffer,
      fileType
    );

    // Save note to Dynamics 365 timeline if active lead present
    if (currentLeadId) {
      const cleanId = currentLeadId.replace(/[{}]/g, '');
      dynamicsService.getChatTranscript(cleanId).then(existing => {
        const history = (existing && existing.messages) ? existing.messages : [];
        history.push({ sender: 'user', text: `Sent quotation/document: ${fileName} to ${toEmail}` });
        history.push({ sender: 'ai', text: `Dispatched document "${fileName}" directly to ${toEmail}. Status: ${result.status}` });
        dynamicsService.saveChatTranscript(cleanId, history).catch(e => console.error(e));
      }).catch(e => console.error(e));
    }

    res.json(result);
  } catch (err) {
    console.error('Error in /api/send-email-attachment:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 📑 INVOICE & QUOTE AI AGENT ENDPOINTS
// ==========================================
const invoiceBrain = require('./invoiceBrain');
const invoicePdfService = require('./invoicePdfService');

// Serve Invoice Agent Widget
app.get('/invoice', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'invoice-widget.html'));
});

// Chat with Invoice AI Copilot
app.post('/api/invoice-agent/chat', async (req, res) => {
  try {
    const { sessionId = 'inv_session', message, context = {} } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const response = await invoiceBrain.processMessage(sessionId, message, context);
    res.json(response);
  } catch (err) {
    console.error('Invoice agent chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Download / Preview Tax Invoice PDF
app.get('/api/invoice-agent/download-pdf/:invoiceNumber', async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    let pdfBuffer = null;

    if (global.invoicePdfCache && global.invoicePdfCache.has(invoiceNumber)) {
      const cached = global.invoicePdfCache.get(invoiceNumber);
      if (cached && cached.data) {
        pdfBuffer = await invoicePdfService.generateInvoicePDF(cached.data);
      } else {
        pdfBuffer = cached ? cached.pdfBuffer : null;
      }
    }

    if (!pdfBuffer) {
      // 100% Dynamic: Fetch live invoice & line items from Dynamics 365 Dataverse
      const liveInvoice = await dynamicsService.getInvoiceByNumber(invoiceNumber);
      if (liveInvoice) {
        pdfBuffer = await invoicePdfService.generateInvoicePDF(liveInvoice);
      }
    }

    if (!pdfBuffer) {
      return res.status(404).json({ error: `Invoice #${invoiceNumber} not found in Dynamics 365.` });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
  }
});

// Convert Quote to Invoice API
app.post('/api/invoice-agent/convert-quote', async (req, res) => {
  try {
    const { quoteId, customerName, email, discountPercent } = req.body;
    const result = await dynamicsService.convertQuoteToInvoice(quoteId, { customerName, email, discountPercent });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark Invoice as Paid API
app.post('/api/invoice-agent/mark-paid', async (req, res) => {
  try {
    const { invoiceId, paymentNote } = req.body;
    const result = await dynamicsService.markInvoiceAsPaid(invoiceId, paymentNote);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {

  console.log('========================================================');
  console.log(`🚀 Sales AI Agent Server running at: http://localhost:${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser to test.`);
  console.log('========================================================');
});
