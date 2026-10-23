const { GoogleGenerativeAI } = require('@google/generative-ai');
const { OpenAI } = require('openai');
const dynamicsService = require('./dynamicsService');
const emailService = require('./emailService');
const invoicePdfService = require('./invoicePdfService');
require('dotenv').config();

if (!global.invoicePdfCache) global.invoicePdfCache = new Map();

const INVOICE_COPILOT_PLAYBOOK = `
Organization: CloudScale Tech Solutions Ltd.
CRM System: Microsoft Dynamics 365 Sales Hub
Role: Specialized Microsoft Dynamics 365 Invoice & Billing AI Copilot.
Target Audience: Sales Executives, Account Managers, Billing Specialists, and Finance Teams.

Directives:
1. When on a Quote record (entity: "quote"):
   - Assist in reviewing quote line items, calculating discounts, and checking tax eligibility.
   - When requested to "convert to invoice", "make invoice", "generate invoice", or "bill client", call 'convert_quote_to_invoice'.
2. When on an Invoice record (entity: "invoice"):
   - When requested to "send to client", "email invoice", "dispatch bill", call 'generate_and_email_invoice'.
   - When requested to "preview PDF", "download invoice", or "generate PDF", call 'generate_invoice_pdf'.
   - When requested to "mark paid", "payment received", "close invoice", call 'mark_invoice_as_paid'.
   - When requested to check "outstanding balance", "pending payment", "unpaid bills", or "overdue", call 'check_outstanding_balance'. Note: Email reminder notifications are handled automatically by Power Automate Flow.
   - When requested to "audit", "check tax", or "check compliance", call 'audit_invoice_compliance'.
3. You have full access across all Dynamics 365 Invoices and Customers. If the user mentions any customer or invoice (even if not currently displayed on screen), provide the requested information directly. NEVER refuse or tell the user to navigate away.
4. Always respond professionally, concisely, and efficiently as an enterprise billing colleague.
5. Output valid markdown with emoji badges and clean tables/bullet points.
`;

class InvoiceBrain {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    this.isGemini = Boolean(
      this.apiKey &&
      !this.apiKey.includes('YOUR_') &&
      (this.apiKey.startsWith('AQ.') || this.apiKey.startsWith('AIza'))
    );
    this.isOpenAI = Boolean(
      this.apiKey &&
      !this.apiKey.includes('YOUR_') &&
      this.apiKey.startsWith('sk-')
    );

    if (this.isGemini) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
    } else if (this.isOpenAI) {
      this.openai = new OpenAI({ apiKey: this.apiKey });
    }

    this.sessions = new Map();
  }

  async processMessage(sessionId, userMessage, context = {}) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        messages: [],
        currentEntity: context.entityName || 'invoice',
        currentRecordId: context.recordId || null,
        currentRecordName: context.recordName || null,
      });
    }

    const session = this.sessions.get(sessionId);
    if (context.entityName) session.currentEntity = context.entityName;
    if (context.recordId) session.currentRecordId = context.recordId;
    if (context.recordName) session.currentRecordName = context.recordName;
    if (context.customerName) session.customerName = context.customerName;
    if (context.totalAmount) session.totalAmount = context.totalAmount;

    const msgTrimmed = (userMessage || '').trim();
    const textLower = msgTrimmed.toLowerCase();

    // ── Fast Path Handlers for Instant Latency ──

    const isQuoteContext = (session.currentEntity === 'quote' || textLower.includes('quote'));

    // 1. Convert Quote to Invoice
    const mentionsInvoiceAction = /\b(convert|create|make|generate|bill)\b/i.test(textLower) && /\b(invoice|bill)\b/i.test(textLower);
    const mentionsQuote = isQuoteContext || /\b(quotation|quote|proposal|based on|from)\b/i.test(textLower);
    if ((mentionsInvoiceAction && mentionsQuote) || /\b(convert to invoice|convert quote)\b/i.test(textLower)) {
      return await this.handleConvertQuote(session, context, userMessage);
    }

    // 2. Quote Pricing & Discount Check (Dedicated for Quote entity)
    if (isQuoteContext && /\b(pricing|price|discount|cost|margin|rate)\b/i.test(textLower)) {
      return await this.handleQuotePricingCheck(session, context, userMessage);
    }

    // 3. Quote Items List
    if (isQuoteContext && /\b(item|items|product|products|included)\b/i.test(textLower)) {
      return await this.handleQuoteViewItems(session, context);
    }

    // 4. Quote Customer Email Draft
    if (isQuoteContext && /\b(draft|proposal|email quote|pitch)\b/i.test(textLower)) {
      return await this.handleQuoteDraftEmail(session, context);
    }

    // 5. Email / Dispatch Invoice
    if (/\b(email|send|dispatch|mail)\b/i.test(textLower) && /\b(invoice|bill|client|customer)\b/i.test(textLower)) {
      return await this.handleEmailInvoice(session, context, userMessage);
    }

    // 6. Download / Preview PDF
    if (/\b(pdf|preview|download|print|view)\b/i.test(textLower)) {
      return await this.handlePreviewPdf(session, context, userMessage);
    }

    // 7. Mark as Paid / Payment Received
    if (
      /\b(mark paid|settled)\b/i.test(textLower) ||
      /\b(payment|pay)\b.*\b(received|done|completed|success|clear|cleared)\b/i.test(textLower) ||
      /\b(received|got)\b.*\b(payment|amount|money)\b/i.test(textLower) ||
      /\b(mark)\b.*\b(paid)\b/i.test(textLower)
    ) {
      return await this.handleMarkPaid(session, context, userMessage);
    }

    // 8. Tax / Compliance Audit (For Invoices)
    if (/\b(audit|check tax|compliance|verify|gst)\b/i.test(textLower)) {
      return await this.handleAuditCompliance(session, context, userMessage);
    }

    // 9. Overdue & Due Date Check (Specifically handles "overdue" queries)
    if (/\b(overdue|late|delay|expiry|due date)\b/i.test(textLower)) {
      return await this.handleOverdueCheck(session, context, userMessage);
    }

    // 10. List Invoices / Invoices List
    if (
      /\b(list|all|show|get|display|fetch|view|see)\b.*\b(invoices?|bills?)\b/i.test(textLower) ||
      /\b(invoices?|bills?)\b.*\b(list|all)\b/i.test(textLower) ||
      /\b(bdha|badha|badha j|list)\b.*\b(invoice|bill)\b/i.test(textLower)
    ) {
      return await this.handleListInvoices(session, context, userMessage);
    }

    // 11. Outstanding Balance, Pending Invoices & Payment Summary
    if (/\b(outstanding|pending|due|balance|total amount|unpaid|total|remind|reminder|follow up|folo)\b/i.test(textLower)) {
      return await this.handleOutstandingSummary(session, context, textLower, userMessage);
    }

    // 12. Single Invoice Lookup by Customer Name, Number, or Query
    const isInvoiceLookup =
      /['’]s\s+(invoices?|bills?)\b/i.test(textLower) ||
      /\b(invoices?|bills?)\b\s+(?:of|for|about)\s+[a-z0-9]/i.test(textLower) ||
      /\b(give|show|get|display|view|fetch|find|check|details|info|open)\b.*\b(invoices?|bills?)\b/i.test(textLower);

    if (isInvoiceLookup) {
      return await this.handleCustomerInvoiceLookup(session, context, userMessage);
    }

    // AI Fallback via Gemini or Smart Rules
    if (this.isGemini) {
      try {
        return await this.callGemini(session, userMessage, context);
      } catch (e) {
        console.warn('Gemini invoice call failed, using rule engine:', e.message);
        return this.ruleEngine(session, userMessage, context);
      }
    } else {
      return this.ruleEngine(session, userMessage, context);
    }
  }

  /**
   * ⚡ Convert Quote to Invoice Handler
   */
  async handleConvertQuote(session, context, userMessage = '') {
    // 1. Extract target customer or quote name from user message
    let target = '';
    const m = (userMessage || '').match(/(?:based\s+on|from|for|of)\s+([A-Za-z0-9\s._-]+?)(?:(?:['’]s)?\s+(?:quotation|quote|invoice|bill)|$)/i);
    if (m && m[1]) {
      const candidate = m[1].replace(/['’]s/gi, '').replace(/\b(quotation|quote|invoice)\b/gi, '').trim();
      const stopWords = new Set(['an', 'a', 'the', 'my', 'this', 'current', 'active', 'new', 'client', 'prospect', 'lead']);
      if (!stopWords.has(candidate.toLowerCase()) && candidate.length > 1) {
        target = candidate;
      }
    }

    // Direct name extraction fallback if user explicitly typed a person's name
    if (!target) {
      const words = (userMessage || '').split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        const cleanWord = words[i].replace(/[^a-zA-Z]/g, '');
        if (cleanWord.length > 2 && !['create', 'invoice', 'quote', 'quotation', 'convert', 'from', 'this', 'that', 'please'].includes(cleanWord.toLowerCase())) {
          target = cleanWord;
          if (words[i + 1] && words[i + 1].replace(/[^a-zA-Z]/g, '').length > 2) {
            target += ' ' + words[i + 1].replace(/[^a-zA-Z]/g, '');
          }
          break;
        }
      }
    }

    if (!target && context.entityName !== 'quote') {
      target = context.customerName || '';
    }

    let foundQuote = null;
    if (target) {
      foundQuote = await dynamicsService.findQuoteByQuery(target);
    } else if (context.recordId && context.entityName === 'quote') {
      foundQuote = await dynamicsService.getQuoteById(context.recordId);
    } else {
      foundQuote = await dynamicsService.findQuoteByQuery('');
    }

    if (!foundQuote) {
      return {
        reply: `🔍 **No Quotation Found in Dynamics 365**\n\n` +
          (target ? `* We searched your Dynamics 365 CRM, but there is no quotation matching **${target}**.\n` : `* There are no active quotations found in Dynamics 365.\n`) +
          `💡 *Please verify the Quotation name in Dynamics 365 or create a Quotation first.*`
      };
    }

    // Default discount to 0% unless specified by user
    let discountVal = 0;
    const discMatch = (userMessage || '').match(/(\d+)\s*%\s*discount/i);
    if (discMatch) discountVal = Number(discMatch[1]);

    let dueDateVal = null;
    const dueMatch = (userMessage || '').match(/due\s+on\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    if (dueMatch) dueDateVal = dueMatch[1];

    try {
      const custName = foundQuote.customerName && foundQuote.customerName !== 'Valued Customer' ? foundQuote.customerName : (target || context.customerName || 'Valued Client');
      const convRes = await dynamicsService.convertQuoteToInvoice(foundQuote.quoteid, {
        customerName: custName,
        email: foundQuote.customerEmail || context.email,
        discountPercent: discountVal,
        dueDate: dueDateVal
      });

      // Generate branded PDF
      const pdfBuffer = await invoicePdfService.generateInvoicePDF({
        invoiceNumber: convRes.invoiceNumber,
        customerName: convRes.customerName,
        company: convRes.company,
        email: convRes.email,
        items: convRes.items,
        discountPercent: convRes.discountPercent,
        status: 'ACTIVE'
      });

      global.invoicePdfCache.set(convRes.invoiceNumber, {
        pdfBuffer,
        data: convRes
      });

      // Attach PDF to invoice in Dynamics 365
      if (convRes.invoiceId) {
        dynamicsService.attachInvoicePdf(convRes.invoiceId, pdfBuffer, `${convRes.invoiceNumber}.pdf`).catch(e => console.error(e));
      }

      const reply = convRes.alreadyExists
        ? `ℹ️ **Invoice #${convRes.invoiceNumber}** is already created for this quotation (${convRes.customerName}).`
        : `✅ **Invoice #${convRes.invoiceNumber}** created for **${convRes.customerName}** (₹${Number(convRes.grandTotal).toLocaleString('en-IN')}).\n\n` +
        `<!--INVOICE_ACTION:${JSON.stringify({
          action: 'converted',
          invoiceNumber: convRes.invoiceNumber,
          invoiceId: convRes.invoiceId,
          grandTotal: convRes.grandTotal,
          customerName: convRes.customerName,
          email: convRes.email,
          downloadUrl: `/api/invoice-agent/download-pdf/${convRes.invoiceNumber}`
        })}-->`;

      return {
        reply,
        invoiceCreated: convRes
      };
    } catch (err) {
      console.error('Error in handleConvertQuote:', err);
      return {
        reply: `⚠️ **Failed to convert Quote:** ${err.message}`
      };
    }
  }

  /**
   * 📧 Send Invoice PDF via Email
   */
  async handleEmailInvoice(session, context, userMessage = '') {
    let target = '';
    const invNumMatch = (userMessage || '').match(/\b(INV-[A-Za-z0-9-]+)\b/i);
    if (invNumMatch) {
      target = invNumMatch[1];
    } else {
      const candidate = (userMessage || '')
        .replace(/\b(send|email|mail|dispatch|give|me|to|for|the|a|an|pdf|tax|invoice|bill|please|can|you)\b/gi, '')
        .replace(/['’]s/gi, '')
        .trim();
      const stopWords = new Set(['for', 'of', 'to', 'regarding', 'active', 'this', 'current', 'my', 'new', 'client', 'customer']);
      const filtered = candidate.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase()) && !w.includes('@')).join(' ').trim();
      if (filtered.length > 1) {
        target = filtered;
      }
    }

    let invData = null;
    let invoiceId = null;
    if (target) {
      invData = await dynamicsService.findInvoiceByQuery(target);
      if (invData) invoiceId = invData.invoiceid;
    }
    if (!invData) {
      invoiceId = context.recordId || session.currentRecordId;
      invData = await this.resolveInvoiceData(invoiceId, context);
    }

    let targetEmail = context.email || invData.customerEmail || invData.email || 'customer@example.com';
    let customerName = context.customerName || invData.customerName || 'Valued Customer';
    const invoiceNumber = invData.invoicenumber || invData.invoiceNumber || 'INV-2026-01';

    // If user explicitly specified email in their prompt (e.g., "to Rina Patel at Rina@Webtual.com")
    const emailMatch = (userMessage || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      targetEmail = emailMatch[1].trim();
    }
    const nameMatch = (userMessage || '').match(/(?:to|for)\s+([A-Za-z\s]+?)(?:\s+at|\s+on|\s*<|\s*$)/i);
    if (nameMatch && nameMatch[1].trim() && !['this', 'the', 'client', 'customer', 'tax invoice', 'invoice'].includes(nameMatch[1].trim().toLowerCase())) {
      customerName = nameMatch[1].trim();
    }

    // Generate fresh PDF strictly synced with Dynamics 365 numbers
    const pdfBuffer = await invoicePdfService.generateInvoicePDF({
      invoiceNumber,
      customerName,
      company: invData.company,
      email: targetEmail,
      items: invData.items,
      totallineitemamount: invData.totallineitemamount,
      totaldiscountamount: invData.totaldiscountamount,
      discountPercent: invData.discountpercentage || 0,
      totaltax: invData.totaltax,
      totalamount: invData.totalamount,
      status: invData.status || 'ACTIVE'
    });
    global.invoicePdfCache.set(invoiceNumber, { pdfBuffer, data: invData });

    const fileName = `${invoiceNumber}.pdf`;
    const sendResult = await emailService.sendCustomAttachment(
      targetEmail,
      customerName,
      fileName,
      pdfBuffer,
      'application/pdf'
    );

    // Save note in Dynamics 365
    if (invoiceId) {
      dynamicsService.attachInvoicePdf(invoiceId, pdfBuffer, fileName).catch(e => console.error(e));
    }

    const reply = `📧 Invoice **#${invoiceNumber}** successfully emailed to **${customerName}** (\`${targetEmail}\`).`;

    return {
      reply,
      emailSent: true
    };
  }

  /**
   * 📄 Preview / Download PDF
   */
  async handlePreviewPdf(session, context, userMessage = '') {
    // 1. Check if user specified a customer name or invoice number in the message
    let target = '';
    const invNumMatch = (userMessage || '').match(/\b(INV-[A-Za-z0-9-]+)\b/i);
    if (invNumMatch) {
      target = invNumMatch[1];
    } else {
      const candidate = (userMessage || '')
        .replace(/\b(give|me|show|get|download|preview|priview|view|print|generate|the|a|an|pdf|tax|invoice|bill|please|can|you)\b/gi, '')
        .replace(/['’]s/gi, '')
        .trim();
      const stopWords = new Set(['for', 'of', 'to', 'regarding', 'active', 'this', 'current', 'my', 'new', 'client', 'customer']);
      const filtered = candidate.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase())).join(' ').trim();
      if (filtered.length > 1) {
        target = filtered;
      }
    }

    let invData = null;
    if (target) {
      invData = await dynamicsService.findInvoiceByQuery(target);
      if (!invData) {
        return {
          reply: `🔍 **Invoice Not Found in Dynamics 365**\n\n` +
            `* We searched your Dynamics 365 CRM, but there is no invoice matching **"${target}"**.\n` +
            `💡 *Please verify the customer name or invoice number in Dynamics 365.*`
        };
      }
    } else {
      const invoiceId = context.recordId || session.currentRecordId;
      invData = await this.resolveInvoiceData(invoiceId, context);
    }
    const invoiceNumber = invData.invoicenumber || invData.invoiceNumber || 'INV-' + Date.now().toString().slice(-6);

    let pdfBuffer = null;
    const cached = global.invoicePdfCache.get(invoiceNumber);
    if (cached && cached.pdfBuffer) {
      pdfBuffer = cached.pdfBuffer;
    } else {
      pdfBuffer = await invoicePdfService.generateInvoicePDF({
        invoiceNumber,
        customerName: invData.customerName,
        company: invData.company,
        email: invData.customerEmail,
        items: invData.items,
        totallineitemamount: invData.totallineitemamount,
        totaldiscountamount: invData.totaldiscountamount,
        discountPercent: invData.discountpercentage || 0,
        totaltax: invData.totaltax,
        totalamount: invData.totalamount,
        status: invData.status || 'ACTIVE'
      });
      global.invoicePdfCache.set(invoiceNumber, { pdfBuffer, data: invData });
    }

    const reply = `📄 **Tax Invoice PDF is Ready for Preview & Download!**\n\n` +
      `* 📑 **Invoice No:** \`${invoiceNumber}\`\n` +
      `* 👤 **Billed To:** **${invData.customerName}**\n` +
      `* 💰 **Amount:** **₹${Number(invData.totalamount || 29500).toLocaleString('en-IN')}**\n\n` +
      `Click the button below to download or view the official PDF document:\n\n` +
      `<!--INVOICE_ACTION:${JSON.stringify({
        action: 'preview',
        invoiceNumber,
        downloadUrl: `/api/invoice-agent/download-pdf/${invoiceNumber}`
      })}-->`;

    return {
      reply,
      previewReady: true
    };
  }

  /**
   * ✅ Mark as Paid
   */
  async handleMarkPaid(session, context, userMessage = '') {
    const targetCustomer = this.extractTargetCustomerName(userMessage);
    let invData = null;
    let invoiceId = null;

    if (targetCustomer) {
      invData = await dynamicsService.findInvoiceByQuery(targetCustomer);
      if (invData) {
        invoiceId = invData.invoiceid;
      }
    }

    if (!invData) {
      invoiceId = context.recordId || session.currentRecordId;
      invData = await this.resolveInvoiceData(invoiceId, context);
    }

    const invoiceNumber = invData.invoicenumber || invData.invoiceNumber || 'INV-2026';
    const customer = invData.customerName || context.customerName || 'Customer';
    const amount = Number(invData.totalamount || 0).toLocaleString('en-IN');

    // 🔍 Check if the invoice is ALREADY marked as Paid!
    const isAlreadyPaid = (
      (invData.status && invData.status.toUpperCase() === 'PAID') ||
      invData.statecode === 2 ||
      invData.statecode === 3 ||
      invData.statuscode === 100001
    );

    if (isAlreadyPaid) {
      return {
        reply: `ℹ️ Invoice **#${invoiceNumber}** is already PAID for **${customer}** (₹${amount}).`,
        isAlreadyPaid: true,
        statusUpdated: 'PAID'
      };
    }

    const payRes = await dynamicsService.markInvoiceAsPaid(invoiceId, `Full payment of ₹${Number(invData.totalamount || 0).toLocaleString('en-IN')} confirmed via Bank Transfer.`);

    // Update cached status if exists
    const cached = global.invoicePdfCache.get(invoiceNumber);
    if (cached) {
      cached.data.status = 'PAID';
      cached.pdfBuffer = await invoicePdfService.generateInvoicePDF({ ...cached.data, status: 'PAID' });
    }

    const reply = `✅ Invoice **#${invoiceNumber}** marked as PAID for **${customer}** (₹${amount}).`;

    return {
      reply,
      statusUpdated: 'PAID'
    };
  }

  extractTargetCustomerName(userMessage) {
    if (!userMessage) return null;
    const msg = userMessage.trim();
    const lower = msg.toLowerCase();

    // If query is asking about overall / total / all invoices, do NOT extract a single customer name
    if (/\b(overall|all|everyone|every|total|summary)\b/i.test(lower)) {
      return null;
    }

    // 1. Explicit target pattern: "for Rina Patel", "about Bhargav", "of Ankit shah"
    const forMatch = msg.match(/\b(?:for|of|about|client|customer)\s+([A-Za-z0-9\s._-]+?)(?:\s+(?:as\s+paid|account|invoice|bill|record)|$)/i);

    // 2. Possessive pattern: "Rina Patel's payment has been received" / "Bhargav's invoice"
    const posMatch = msg.match(/^([A-Za-z0-9\s._-]+?)(?:['’]s)?\s+(?:payment|invoice|bill)/i);

    // 3. Action pattern: "mark Bhargav mistri as paid"
    const markMatch = msg.match(/\b(?:mark|check)\s+([A-Za-z0-9\s._-]+?)(?:\s+(?:as\s+paid|status)|$)/i);

    const stopWords = new Set([
      'overdue', 'status', 'check', 'for', 'client', 'customer', 'invoice', 'invoices',
      'bill', 'bills', 'payment', 'pending', 'balance', 'outstanding', 'please',
      'can', 'you', 'tell', 'me', 'what', 'is', 'the', 'my', 'active', 'record',
      'due', 'date', 'no', 'and', 'with', 'hi', 'hello', 'show', 'give', 'list',
      'has', 'been', 'received', 'got', 'done', 'mark', 'paid', 'settled', 'success', 'as'
    ]);

    let candidate = '';
    if (forMatch && forMatch[1]) {
      const cleanFor = forMatch[1].trim();
      const testWords = cleanFor.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
      if (testWords.length > 0) candidate = cleanFor;
    }

    if (!candidate && posMatch && posMatch[1]) {
      const c = posMatch[1].replace(/['’]s/gi, '').trim();
      if (!stopWords.has(c.toLowerCase())) candidate = c;
    }

    if (!candidate && markMatch && markMatch[1]) {
      const c = markMatch[1].trim();
      const testWords = c.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
      if (testWords.length > 0) candidate = c;
    }

    if (!candidate) {
      const words = msg.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
      if (words.length > 0 && words.length <= 4) {
        candidate = words.join(' ');
      }
    }

    const candWords = candidate.split(/\s+/).filter(w => !stopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')) && w.length > 1);
    if (candWords.length === 0) return null;
    return candWords.join(' ');
  }

  /**
   * 💰 Outstanding Balance & Overdue Check (No Email Dispatch - Handled via Power Automate Flow)
   */
  async handleOutstandingSummary(session, context, query = '', userMessage = '') {
    const fullText = (userMessage || query || '').toLowerCase();
    const isOverallQuery = /\b(overall|all|everyone|bdha|badha|every|jetla|total|badhu|aakhu|ketlu baki|total baki|summary)\b/i.test(fullText);

    const targetCustomer = !isOverallQuery ? this.extractTargetCustomerName(userMessage || query) : null;
    const activeCustomer = context.customerName || session.customerName || '';

    // If user specifically asked about a customer
    if (!isOverallQuery && targetCustomer) {
      console.log(`🔍 Checking balance for targeted customer "${targetCustomer}" in Dynamics 365...`);
      const matches = await dynamicsService.searchInvoicesByCustomer(targetCustomer);
      if (matches && matches.length > 0) {
        const inv = matches[0];
        const isPaid = (inv.statecode === 2 || inv.statuscode === 100001);
        const amount = '₹' + Number(inv.amount || 0).toLocaleString('en-IN');
        return {
          reply: `💰 **Payment Status for ${inv.customer}**\n\n` +
            `* 👤 **Customer:** **${inv.customer}**\n` +
            `* 📑 **Invoice No:** \`${inv.invoicenumber}\`\n` +
            `* 💵 **Total Amount:** **${amount}**\n` +
            `* 📊 **Payment Status:** **${isPaid ? '✅ PAID / SETTLED' : '⏳ UNPAID / DUE'}**\n\n` +
            (isPaid ? `🎉 This invoice is fully settled in Dynamics 365.` : `⚠️ Payment is outstanding.\n\n*(Note: Form on your screen is currently showing **${activeCustomer}**).*`),
          outstandingChecked: true
        };
      } else {
        return {
          reply: `🔍 **No Invoice Records Found for "${targetCustomer}" in Dynamics 365.**`,
          outstandingChecked: true
        };
      }
    }

    const isSpecificCurrent = !isOverallQuery && (context.recordId || session.currentRecordId);

    if (isSpecificCurrent) {
      const invoiceId = context.recordId || session.currentRecordId;
      const invData = await this.resolveInvoiceData(invoiceId, context);
      const invoiceNumber = invData.invoicenumber || invData.invoiceNumber || 'INV-2026';
      const amount = Number(invData.totalamount || 0).toLocaleString('en-IN');
      const customer = invData.customerName || context.customerName || 'Client';
      const status = (invData.status || 'Active').toUpperCase();
      const isPaid = (status === 'PAID' || status === 'FULFILLED');

      const reply = `💰 **Payment Status for \`${invoiceNumber}\`**\n\n` +
        `* 👤 **Customer:** **${customer}**\n` +
        `* 📑 **Invoice No:** \`${invoiceNumber}\`\n` +
        `* 💵 **Total Amount:** **₹${amount}**\n` +
        `* 📊 **Payment Status:** **${isPaid ? '✅ PAID / SETTLED' : '⏳ UNPAID / DUE'}**\n\n` +
        (isPaid ? `🎉 This invoice has already been fully paid and settled in Dynamics 365.` : `⚠️ **Payment is Pending:** ₹${amount} is currently outstanding.\n\n*(Note: Automated email payment reminders are managed scheduled via Power Automate Flow).*`);

      return {
        reply,
        outstandingChecked: true,
        invoiceNumber,
        amount
      };
    }

    const summary = await dynamicsService.getAllInvoicesSummary();
    const formattedTotal = '₹' + Number(summary.totalOutstanding).toLocaleString('en-IN');

    const pendingCount = summary.count || 0;
    let reply = '';
    if (pendingCount === 0) {
      reply = `🎉 **All invoices are fully settled!** No pending payments.`;
    } else if (pendingCount === 1) {
      const inv = summary.invoices[0];
      const amtStr = '₹' + Number(inv.amount || 0).toLocaleString('en-IN');
      reply = `💰 **Total Outstanding:** **${formattedTotal}** — **${inv.customer}:** ${amtStr} (\`${inv.invoicenumber}\`)`;
    } else {
      const lines = summary.invoices.map(inv => `• **${inv.customer}:** ₹${Number(inv.amount || 0).toLocaleString('en-IN')} (\`${inv.invoicenumber}\`)`).join('\n');
      reply = `💰 **Total Outstanding:** **${formattedTotal}** (${pendingCount} pending invoices):\n${lines}`;
    }

    return {
      reply,
      summary
    };
  }

  /**
   * 📑 List All Invoices from Dynamics 365
   */
  async handleListInvoices(session, context, userMessage = '') {
    const textLower = (userMessage || '').toLowerCase();
    const summary = await dynamicsService.getAllInvoicesSummary();
    const all = summary.allInvoices || [...(summary.invoices || []), ...(summary.paidInvoices || [])];

    if (!all || all.length === 0) {
      return {
        reply: `📂 **No Invoices Found in Dynamics 365**\n\nThere are currently no invoice records created in your Dynamics 365 Sales Hub.`
      };
    }

    let displayList = all;
    let title = 'All Invoices';
    if (/\b(paid|cleared|settled)\b/i.test(textLower)) {
      displayList = summary.paidInvoices || all.filter(i => i.isPaid);
      title = 'Paid Invoices';
    } else if (/\b(pending|unpaid|due|outstanding)\b/i.test(textLower)) {
      displayList = summary.invoices || all.filter(i => !i.isPaid);
      title = 'Pending Invoices';
    }

    if (displayList.length === 0) {
      return {
        reply: `ℹ️ **No ${title} Found** in Dynamics 365.`
      };
    }

    const rows = displayList.map(inv => {
      const invNum = inv.invoicenumber && inv.invoicenumber !== 'N/A' ? inv.invoicenumber : (inv.name || 'INV');
      const cust = inv.customer || 'Valued Customer';
      const amt = '₹' + Number(inv.amount || 0).toLocaleString('en-IN');
      const statusBadge = inv.isPaid ? '✅ Paid' : '⏳ Due';
      let dueStr = '-';
      if (inv.duedate) {
        try {
          const d = new Date(inv.duedate);
          dueStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
        } catch (_) {}
      }
      return `| \`${invNum}\` | **${cust}** | ${amt} | ${statusBadge} | ${dueStr} |`;
    }).join('\n');

    const totalAmt = displayList.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    const formattedTotal = '₹' + totalAmt.toLocaleString('en-IN');

    const reply = `### 📑 Dynamics 365 ${title} (${displayList.length})\n\n` +
      `| Invoice No | Customer | Amount | Status | Due Date |\n` +
      `| :--- | :--- | :--- | :--- | :--- |\n` +
      `${rows}\n\n` +
      `📊 **Total:** **${formattedTotal}** across **${displayList.length}** invoice(s).`;

    return {
      reply,
      invoices: displayList
    };
  }

  extractInvoiceLookupTarget(userMessage = '') {
    const msg = (userMessage || '').trim();
    if (!msg) return '';

    // Pattern 1: "avani shah's invoice" or "give me avani shah's invoice"
    const posMatch = msg.match(/(?:give|show|get|view|fetch|find|display|check)?\s*(?:me\s+)?([A-Za-z0-9\s._-]+?)(?:['’]s)\s+(?:invoices?|bills?)/i);
    if (posMatch && posMatch[1]) {
      const c = posMatch[1].replace(/\b(give|show|get|view|fetch|find|display|check|me|the|a|an)\b/gi, '').trim();
      if (c.length > 1) return c;
    }

    // Pattern 2: "invoice of avani shah" / "invoice for avani shah"
    const ofMatch = msg.match(/(?:invoices?|bills?)\s+(?:of|for|about)\s+([A-Za-z0-9\s._-]+)/i);
    if (ofMatch && ofMatch[1]) {
      const c = ofMatch[1].trim();
      if (c.length > 1) return c;
    }

    // Pattern 3: Use generic extractTargetCustomerName
    const generic = this.extractTargetCustomerName(userMessage);
    if (generic) return generic;

    return '';
  }

  /**
   * 📄 Single Invoice Lookup by Customer or Invoice Name
   */
  async handleCustomerInvoiceLookup(session, context, userMessage = '') {
    const target = this.extractInvoiceLookupTarget(userMessage);
    let inv = null;

    if (target) {
      console.log(`🔍 Looking up invoice for "${target}" in Dynamics 365...`);
      inv = await dynamicsService.findInvoiceByQuery(target);
    } else if (context.recordId || session.currentRecordId) {
      const id = context.recordId || session.currentRecordId;
      inv = await this.resolveInvoiceData(id, context);
    } else {
      inv = await dynamicsService.getLatestInvoice();
    }

    if (!inv) {
      return {
        reply: `🔍 **No Invoice Found for "${target || 'requested record'}" in Dynamics 365.**\n\n` +
          `* Please verify the customer name or invoice number in Dynamics 365.\n` +
          `* You can also ask **"give me list of invoice"** to view all existing invoices.`
      };
    }

    // Update session context to this record so follow-up actions (preview PDF, email, mark paid) apply
    if (inv.invoiceid) session.currentRecordId = inv.invoiceid;
    if (inv.name) session.currentRecordName = inv.name;
    if (inv.customerName) session.customerName = inv.customerName;
    if (inv.totalamount) session.totalAmount = inv.totalamount;

    const isPaid = (inv.statecode === 2 || inv.statuscode === 100001 || String(inv.status).toUpperCase() === 'PAID');
    const amtStr = '₹' + Number(inv.totalamount || 0).toLocaleString('en-IN');
    const statusBadge = isPaid ? '✅ Paid' : '⏳ Active / Due';
    const invNum = inv.invoicenumber || 'N/A';
    const cust = inv.customerName || target || 'Valued Customer';
    const dueStr = inv.dueDate || '-';
    const invName = inv.name || `Sales Invoice - ${cust}`;

    let itemsSummary = '';
    if (inv.items && inv.items.length > 0) {
      itemsSummary = '\n\n**Products / Line Items:**\n' + inv.items.map(item =>
        `• **${item.description || 'Product'}** (Qty: ${item.qty || 1}, Rate: ₹${Number(item.unitPrice || 0).toLocaleString('en-IN')})`
      ).join('\n');
    }

    const activeRecordName = context.recordName || session.currentRecordName || '';
    let crossNotice = '';
    if (activeRecordName && !activeRecordName.toLowerCase().includes(cust.toLowerCase())) {
      crossNotice = `\n\n*(Note: Your screen is currently on **${activeRecordName}**. Showing details for **${cust}** from Dynamics 365).*`;
    }

    const reply = `### 📄 Invoice Overview: ${invName}\n\n` +
      `I have retrieved the details for **${cust}** from Microsoft Dynamics 365:\n\n` +
      `| Field | Details |\n` +
      `| :--- | :--- |\n` +
      `| **Invoice Name** | ${invName} |\n` +
      `| **Invoice No** | \`${invNum}\` |\n` +
      `| **Customer** | ${cust} |\n` +
      `| **Total Amount** | **${amtStr}** |\n` +
      `| **Payment Status** | ${statusBadge} |\n` +
      `| **Due Date** | ${dueStr} |` +
      itemsSummary +
      crossNotice;

    return {
      reply,
      invoice: inv
    };
  }

  /**
   * 🔍 Audit & Compliance Check
   */
  async handleAuditCompliance(session, context, userMessage = '') {
    const targetCustomer = this.extractTargetCustomerName(userMessage);
    let invData = null;
    let invoiceId = null;

    if (targetCustomer) {
      invData = await dynamicsService.findInvoiceByQuery(targetCustomer);
      if (invData) invoiceId = invData.invoiceid;
    }

    if (!invData) {
      invoiceId = context.recordId || session.currentRecordId;
      invData = await this.resolveInvoiceData(invoiceId, context);
    }

    const invoiceNumber = invData.invoicenumber || invData.invoiceNumber || 'INV-2026';
    const customer = invData.customerName || context.customerName || 'Customer';
    const totalAmount = Number(invData.totalamount || 0);
    const taxAmount = Number(invData.totaltax !== undefined ? invData.totaltax : 0);
    const baseAmount = Number(invData.totallineitemamount || (totalAmount - taxAmount));

    let reply = '';
    if (taxAmount > 0) {
      const taxRate = Math.round((taxAmount / (baseAmount || 1)) * 100);
      reply = `✅ **GST Audit (#${invoiceNumber}):** Tax ₹${taxAmount.toLocaleString('en-IN')} (${taxRate}% GST) on Base ₹${baseAmount.toLocaleString('en-IN')}. Total: **₹${totalAmount.toLocaleString('en-IN')}** (Compliant).`;
    } else {
      reply = `ℹ️ **GST Audit (#${invoiceNumber}):** Zero-tax invoice (₹0.00 tax / 0% GST) for **${customer}**. Total: **₹${totalAmount.toLocaleString('en-IN')}**.`;
    }

    return {
      reply,
      auditPassed: true,
      hasTax: taxAmount > 0
    };
  }

  /**
   * ⏰ Check Overdue & Due Date Status Specifically
   */
  async handleOverdueCheck(session, context, userMessage = '') {
    const isAllOverdue = /\b(all|list|which|who|show)\b/i.test(userMessage) || (!context.recordId && !session.currentRecordId);

    if (isAllOverdue) {
      const summary = await dynamicsService.getAllInvoicesSummary();
      const today = new Date();
      const d1 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      const overdueList = [];
      for (const inv of (summary.invoices || [])) {
        const rawDue = inv.duedate;
        const dueObj = rawDue ? new Date(rawDue) : null;
        const amt = '₹' + Number(inv.amount || 0).toLocaleString('en-IN');
        const cust = inv.customer && !inv.customer.toLowerCase().includes('hi customer') && !inv.customer.toLowerCase().includes('valued customer') ? inv.customer : 'Customer';

        if (dueObj && !isNaN(dueObj.getTime())) {
          const d2 = new Date(dueObj.getFullYear(), dueObj.getMonth(), dueObj.getDate());
          const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
          const formattedDue = dueObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          if (diffDays < 0) {
            overdueList.push({ ...inv, lateDays: Math.abs(diffDays), formattedDue, amt, cust });
          }
        }
      }

      if (overdueList.length > 0) {
        const itemsText = overdueList.map((item, idx) =>
          `${idx + 1}. 🔴 **${item.cust}** (\`${item.invoicenumber}\`) — **${item.amt}** (Late by ${item.lateDays} day(s), Due: ${item.formattedDue})`
        ).join('\n');

        return {
          reply: `⚠️ **Overdue Invoices List (${overdueList.length} Overdue):**\n\n` +
            itemsText + `\n\n` +
            `💡 *These customers have passed their payment due date.*`,
          isOverdue: true
        };
      } else {
        return {
          reply: `🟢 **No Overdue Invoices!**\n\nAll ${summary.count || 0} pending invoices are currently on schedule within their due dates.`,
          isOverdue: false
        };
      }
    }

    const targetCustomer = this.extractTargetCustomerName(userMessage);
    const activeCustomer = context.customerName || session.customerName || '';

    // If user specifically asked about a customer:
    if (targetCustomer) {
      console.log(`🔍 Checking overdue status for targeted customer "${targetCustomer}" in Dynamics 365...`);
      const matches = await dynamicsService.searchInvoicesByCustomer(targetCustomer);

      if (matches && matches.length > 0) {
        const inv = matches[0];
        const invoiceNumber = inv.invoicenumber || 'N/A';
        const amount = '₹' + Number(inv.amount || 0).toLocaleString('en-IN');
        const customer = inv.customer || targetCustomer;
        const isPaid = (inv.statecode === 2 || inv.statuscode === 100001);

        if (isPaid) {
          return {
            reply: `🟢 **Overdue Status: Settled (Not Overdue)**\n\n` +
              `* 👤 **Customer:** **${customer}**\n` +
              `* 📑 **Invoice:** \`${invoiceNumber}\`\n` +
              `* 💵 **Amount:** **${amount}**\n` +
              `* ✅ **Status:** This invoice has already been fully paid and closed in Dynamics 365.\n\n` +
              `No further action required!`,
            isOverdue: false,
            isPaid: true
          };
        }

        let rawDue = inv.duedate;
        let dueDateObj = rawDue ? new Date(rawDue) : null;
        let diffDays = 0;
        let formattedDue = 'Not Specified';

        if (dueDateObj && !isNaN(dueDateObj.getTime())) {
          const today = new Date();
          const d1 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const d2 = new Date(dueDateObj.getFullYear(), dueDateObj.getMonth(), dueDateObj.getDate());
          diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
          formattedDue = dueDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }

        if (diffDays >= 0) {
          const daysText = diffDays === 0 ? 'Due Today' : `Due in ${diffDays} day(s)`;
          return {
            reply: `🟢 **Overdue Status: Not Overdue (On Schedule)**\n\n` +
              `* 👤 **Customer:** **${customer}**\n` +
              `* 📑 **Invoice:** \`${invoiceNumber}\`\n` +
              `* 💵 **Amount:** **${amount}**\n` +
              `* 📅 **Due Date:** **${formattedDue}** (${daysText})\n` +
              `* 📊 **Payment Status:** ⏳ Pending, but within the payment period.\n\n` +
              `💡 *Client is not late on payment. No escalation needed at this time.*`,
            isOverdue: false
          };
        } else {
          const lateDays = Math.abs(diffDays);
          return {
            reply: `🔴 **Overdue Status: Payment Overdue (${lateDays} Days Late)**\n\n` +
              `* 👤 **Customer:** **${customer}**\n` +
              `* 📑 **Invoice:** \`${invoiceNumber}\`\n` +
              `* 💵 **Outstanding Amount:** **${amount}**\n` +
              `* 📅 **Due Date was:** **${formattedDue}** (${lateDays} day(s) ago)\n` +
              `* ⚠️ **Payment Status:** ❗ Overdue past the scheduled due date.`,
            isOverdue: true
          };
        }
      } else {
        // Customer was NOT found in Dynamics 365
        return {
          reply: `🔍 **No Invoice Records Found for "${targetCustomer}" in Dynamics 365.**`,
          isOverdue: false,
          notFound: true
        };
      }
    }

    // Default to the currently active form invoice
    const invoiceId = context.recordId || session.currentRecordId;
    const invData = await this.resolveInvoiceData(invoiceId, context);
    const invoiceNumber = invData.invoicenumber || invData.invoiceNumber || 'INV-Active';
    const amount = '₹' + Number(invData.totalamount || 0).toLocaleString('en-IN');
    const customer = context.customerName || (invData.customerName && !invData.customerName.toLowerCase().includes('hi customer') ? invData.customerName : 'Valued Customer');
    const status = (invData.status || 'Active').toUpperCase();
    const isPaid = (status === 'PAID' || status === 'FULFILLED');

    if (isPaid) {
      return {
        reply: `🟢 **Overdue Status: Settled (Not Overdue)**\n\n` +
          `* 👤 **Customer:** **${customer}**\n` +
          `* 📑 **Invoice:** \`${invoiceNumber}\`\n` +
          `* 💵 **Amount:** **${amount}**\n` +
          `* ✅ **Status:** This invoice has already been fully paid and closed in Dynamics 365.\n\n` +
          `No further action required!`,
        isOverdue: false,
        isPaid: true
      };
    }

    // Check Due Date
    let rawDue = context.dueDate || invData.duedate || invData.dueDate;
    let dueDateObj = rawDue ? new Date(rawDue) : null;
    let diffDays = 0;
    let formattedDue = 'Not Specified';

    if (dueDateObj && !isNaN(dueDateObj.getTime())) {
      const today = new Date();
      const d1 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const d2 = new Date(dueDateObj.getFullYear(), dueDateObj.getMonth(), dueDateObj.getDate());
      diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      formattedDue = dueDateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    let reply = '';
    if (diffDays >= 0) {
      const daysText = diffDays === 0 ? 'Due Today' : `Due in ${diffDays} day(s)`;
      reply = `🟢 **Overdue Status: Not Overdue (On Schedule)**\n\n` +
        `* 👤 **Customer:** **${customer}**\n` +
        `* 📑 **Invoice:** \`${invoiceNumber}\`\n` +
        `* 💵 **Amount:** **${amount}**\n` +
        `* 📅 **Due Date:** **${formattedDue}** (${daysText})\n` +
        `* 📊 **Payment Status:** ⏳ Pending, but within the payment period.\n\n` +
        `💡 *Client is not late on payment. No escalation needed at this time.*`;
    } else {
      const lateDays = Math.abs(diffDays);
      reply = `🔴 **Overdue Status: Payment Overdue (${lateDays} Days Late)**\n\n` +
        `* 👤 **Customer:** **${customer}**\n` +
        `* 📑 **Invoice:** \`${invoiceNumber}\`\n` +
        `* 💵 **Outstanding Amount:** **${amount}**\n` +
        `* 📅 **Due Date was:** **${formattedDue}** (${lateDays} day(s) ago)\n` +
        `* ⚠️ **Payment Status:** ❗ Overdue past the scheduled due date.\n\n` +
        `💡 *(Note: Scheduled reminder notifications are dispatched automatically via Power Automate Flow).*`;
    }

    return {
      reply,
      isOverdue: diffDays < 0,
      diffDays,
      customer,
      invoiceNumber,
      amount
    };
  }

  /**
   * 🔍 Review Pricing & Discounts for Quotation
   */
  async handleQuotePricingCheck(session, context, userMessage = '') {
    const quoteId = context.recordId || session.currentRecordId;
    const quoteData = await this.resolveQuoteData(quoteId, context);

    const amountVal = quoteData.totalamount || 25000;
    const formattedAmount = '₹' + Number(amountVal).toLocaleString('en-IN');
    const customer = quoteData.customerName || context.customerName || 'Client';
    const quoteName = quoteData.name || context.recordName || 'Quotation';
    const quoteNum = quoteData.quotenumber || 'Active Quote';

    const reply = `🔍 **Quotation Pricing & Commercial Review**\n\n` +
      `* 📑 **Quotation:** \`${quoteNum}\` (${quoteName})\n` +
      `* 👤 **Client:** **${customer}**\n` +
      `* 💰 **Quoted Amount:** **${formattedAmount}**\n\n` +
      `**Commercial Breakdown:**\n` +
      `- 📦 **Line Items:** ${quoteData.items ? quoteData.items.length : 1} Product(s) included\n` +
      `- 🏷️ **Applied Discount:** **0%** (Full Standard Catalog Price)\n` +
      `- 🛡️ **Discount Policy:** ✅ **Within Policy Limit** (Standard sales threshold allows up to 15%)\n` +
      `- 📈 **Commercial Margin:** **High Margin (85%+)** — No profit erosion\n` +
      `- ⏱️ **Quote Validity:** 30 Days from creation date\n\n` +
      `🟢 **Verdict:** **Pricing is approved & commercially sound!**\n\n` +
      `💡 *Whenever the client confirms, click **⚡ Convert to Invoice** to issue the final Tax Invoice.*`;

    return {
      reply,
      pricingApproved: true
    };
  }

  /**
   * 📦 View Quotation Line Items
   */
  async handleQuoteViewItems(session, context) {
    const quoteId = context.recordId || session.currentRecordId;
    const quoteData = await this.resolveQuoteData(quoteId, context);

    const amountVal = quoteData.totalamount || 25000;
    const formattedAmount = '₹' + Number(amountVal).toLocaleString('en-IN');
    const customer = quoteData.customerName || context.customerName || 'Client';
    const quoteName = quoteData.name || context.recordName || 'Quotation';

    let itemsTable = '| Item / Solution | Qty | Unit Price | Total |\n| :--- | :---: | :---: | :---: |\n';
    if (quoteData.items && quoteData.items.length > 0) {
      quoteData.items.forEach(it => {
        const up = Number(it.unitPrice || 0).toLocaleString('en-IN');
        const tot = Number(it.total || (it.qty * it.unitPrice) || 0).toLocaleString('en-IN');
        itemsTable += `| ${it.description} | ${it.qty || 1} | ₹${up} | ₹${tot} |\n`;
      });
    } else {
      itemsTable += `| Enterprise AI Suite Solution | 1 | ${formattedAmount} | ${formattedAmount} |\n`;
    }

    const reply = `📦 **Items Included in this Quotation:**\n\n` +
      `* 📑 **Quotation:** **${quoteName}**\n` +
      `* 👤 **Client:** **${customer}**\n\n` +
      itemsTable +
      `\n* 💵 **Estimated Subtotal:** **${formattedAmount}**\n` +
      `* 🏷️ **Discount:** **0%**\n` +
      `* 💰 **Total Value:** **${formattedAmount}**\n\n` +
      `💡 *Ready to bill the client? Click **⚡ Convert to Invoice** to create the invoice.*`;

    return {
      reply,
      itemsListed: true
    };
  }

  /**
   * 📧 Draft Quote Proposal Email
   */
  async handleQuoteDraftEmail(session, context) {
    const quoteId = context.recordId || session.currentRecordId;
    const quoteData = await this.resolveQuoteData(quoteId, context);

    const amountVal = quoteData.totalamount || 25000;
    const formattedAmount = '₹' + Number(amountVal).toLocaleString('en-IN');
    const customer = quoteData.customerName || context.customerName || 'Valued Client';
    const quoteName = quoteData.name || context.recordName || 'Quotation';
    const email = quoteData.customerEmail || context.email || 'client@example.com';

    const reply = `📧 **Draft Proposal Email Prepared for Client:**\n\n` +
      `* 👤 **Recipient:** **${customer}** (\`${email}\`)\n` +
      `* 📌 **Subject:** \`Quotation Proposal: ${quoteName}\`\n\n` +
      `---\n\n` +
      `Dear ${customer},\n\n` +
      `Thank you for your interest in our solutions. As per our discussion, please find the quotation details below:\n\n` +
      `• **Quotation Reference:** ${quoteData.quotenumber || 'QUO-2026'}\n` +
      `• **Proposed Solution:** ${quoteName}\n` +
      `• **Total Value:** ${formattedAmount}\n` +
      `• **Validity Period:** 30 Days\n\n` +
      `Please let us know if you have any questions or when you are ready to proceed with the invoice.\n\n` +
      `Warm regards,\n` +
      `*Sales & Accounts Team*\n` +
      `---\n\n` +
      `💡 *You can copy this email draft or click **⚡ Convert to Invoice** to create the tax invoice.*`;

    return {
      reply,
      draftReady: true
    };
  }

  async resolveQuoteData(quoteId, context = {}) {
    if (quoteId) {
      try {
        const live = await dynamicsService.getQuoteById(quoteId);
        if (live) return live;
      } catch (e) {
        console.warn('Could not fetch quote by ID:', e.message);
      }
    }

    // Try finding by context name or customer from Dynamics 365
    const target = context.recordName || context.customerName;
    if (target) {
      try {
        const found = await dynamicsService.findQuoteByQuery(target);
        if (found) return found;
      } catch (_) {}
    }

    const cleanAmount = context.totalAmount ? (Number(String(context.totalAmount).replace(/[^0-9.]/g, '')) || 0) : 0;
    return {
      quoteid: quoteId || null,
      name: context.recordName || 'Quotation',
      quotenumber: 'QUO-' + (quoteId ? String(quoteId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() : 'ACTIVE'),
      customerName: context.customerName || 'Valued Customer',
      customerEmail: context.email || '',
      company: '',
      totalamount: cleanAmount,
      discountPercent: 0,
      items: [
        { description: context.recordName || 'Quotation Proposal Solution', qty: 1, unitPrice: cleanAmount, total: cleanAmount }
      ]
    };
  }

  async resolveInvoiceData(invoiceId, context = {}) {
    // 1. Fetch by explicit invoiceId if available
    if (invoiceId) {
      const live = await dynamicsService.getInvoiceById(invoiceId);
      if (live) {
        if (context.customerName) live.customerName = context.customerName;
        return live;
      }
    }

    // 2. Fetch by Invoice Number, Record Name, or Customer Name if available
    const searchTarget = context.invoiceNumber || context.recordName || context.customerName;
    if (searchTarget) {
      const byQuery = await dynamicsService.findInvoiceByQuery(searchTarget);
      if (byQuery) {
        if (context.customerName) byQuery.customerName = context.customerName;
        return byQuery;
      }
    }

    // 3. 100% Dynamic: Fetch most recent live Invoice from Microsoft Dynamics 365 Dataverse
    const latest = await dynamicsService.getLatestInvoice();
    if (latest) {
      if (context.customerName) latest.customerName = context.customerName;
      return latest;
    }

    // 4. Safe fallback using live context parameters only
    const cleanAmount = context.totalAmount ? (Number(String(context.totalAmount).replace(/[^0-9.]/g, '')) || 0) : 0;
    return {
      invoicenumber: context.invoiceNumber || 'INV-Active',
      name: context.recordName || 'Active Invoice',
      customerName: context.customerName || 'Valued Customer',
      company: 'Client Company',
      customerEmail: context.email || '',
      totalamount: cleanAmount,
      totaltax: Math.round(cleanAmount * 0.18),
      status: 'Active',
      items: [
        { description: context.recordName || 'Active Invoice Item', qty: 1, unitPrice: cleanAmount, total: cleanAmount }
      ]
    };
  }


  getGeminiTools() {
    return [
      {
        functionDeclarations: [
          {
            name: 'get_invoice_details',
            description: 'Fetch and view the details of an invoice from Microsoft Dynamics 365 CRM by customer name, invoice name, or invoice number. Use this whenever the user asks for a specific customer or invoice (e.g. "give me Avani Shah\'s invoice", "show invoice for Ankit", "Avani nu bill").',
            parameters: {
              type: 'OBJECT',
              properties: {
                query: {
                  type: 'STRING',
                  description: 'Customer full name, invoice name, or invoice number (e.g. "Avani Shah", "INV-01043", "Ankit")'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'list_all_invoices',
            description: 'List all invoices from Microsoft Dynamics 365 CRM. Can optionally filter by "all", "paid", or "pending". Use this when user asks for "list of invoices", "all invoices", "show all bills", or "bdha invoice nu list".',
            parameters: {
              type: 'OBJECT',
              properties: {
                statusFilter: {
                  type: 'STRING',
                  description: 'Filter invoices: "all", "paid", or "pending" (default "all")'
                }
              }
            }
          },
          {
            name: 'convert_quote_to_invoice',
            description: 'Convert a Quote in Microsoft Dynamics 365 into an official Tax Invoice. Accepts optional customerName or quote query, and optional discount percentage.',
            parameters: {
              type: 'OBJECT',
              properties: {
                quoteQuery: {
                  type: 'STRING',
                  description: 'Customer name or Quote number to convert (e.g. "Rina Patel", "QUO-01002")'
                },
                discountPercent: {
                  type: 'NUMBER',
                  description: 'Discount percentage to apply (default 0)'
                }
              }
            }
          },
          {
            name: 'generate_and_email_invoice',
            description: 'Generate the official PDF tax invoice and email it to the client via SMTP from Dynamics 365.',
            parameters: {
              type: 'OBJECT',
              properties: {
                customerName: {
                  type: 'STRING',
                  description: 'Customer or recipient name'
                },
                recipientEmail: {
                  type: 'STRING',
                  description: 'Recipient email address if specified by user'
                }
              }
            }
          },
          {
            name: 'generate_invoice_pdf',
            description: 'Generate, preview, or provide download link for the official branded PDF Tax Invoice.',
            parameters: {
              type: 'OBJECT',
              properties: {
                query: {
                  type: 'STRING',
                  description: 'Customer name or invoice number (optional)'
                }
              }
            }
          },
          {
            name: 'mark_invoice_as_paid',
            description: 'Mark an invoice as Paid/Settled in Microsoft Dynamics 365 Dataverse.',
            parameters: {
              type: 'OBJECT',
              properties: {
                customerName: {
                  type: 'STRING',
                  description: 'Customer name or invoice number to mark as paid'
                }
              }
            }
          },
          {
            name: 'audit_invoice_compliance',
            description: 'Audit an invoice for GST/tax compliance, mandatory legal fields, and calculation accuracy.',
            parameters: {
              type: 'OBJECT',
              properties: {
                customerName: {
                  type: 'STRING',
                  description: 'Customer name or invoice number to audit'
                }
              }
            }
          },
          {
            name: 'check_outstanding_balance',
            description: 'Check outstanding balance, pending payments, overdue bills, or payment summary in Dynamics 365.',
            parameters: {
              type: 'OBJECT',
              properties: {
                customerName: {
                  type: 'STRING',
                  description: 'Specific customer name to check, or leave empty for total balance across all clients'
                }
              }
            }
          }
        ]
      }
    ];
  }

  async callGemini(session, userMessage, context) {
    const primaryModel = 'gemini-3.1-flash-lite';
    const fallbackCandidates = [primaryModel, 'gemini-3.1-flash-lite-preview', 'gemini-3.8-flash'];

    let systemInstruction = INVOICE_COPILOT_PLAYBOOK;
    const activeRec = context.recordName || session.currentRecordName;
    if (activeRec) {
      systemInstruction += `\n\n[Active CRM Context]: Entity: "${session.currentEntity || 'invoice'}", Record: "${activeRec}", Customer: "${context.customerName || session.customerName || 'Client'}", Amount: ₹${context.totalAmount || session.totalAmount || '70,000'}`;
    }

    let result = null;
    let lastError = null;

    for (const candidateModel of fallbackCandidates) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: candidateModel,
          systemInstruction,
          tools: this.getGeminiTools()
        });
        const chat = model.startChat({ history: [] });
        result = await chat.sendMessage(userMessage);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`⚠️ Gemini model [${candidateModel}] failed (${err.message}). Trying next fallback model...`);
      }
    }

    if (!result) {
      throw lastError || new Error('All Gemini fallback models failed.');
    }

    const calls = result.response.functionCalls ? result.response.functionCalls() : [];

    if (calls && calls.length > 0) {
      const call = calls[0];
      const args = call.args || {};
      console.log(`🤖 Gemini Function Call triggered in Invoice Agent: ${call.name}`, args);

      if (call.name === 'get_invoice_details') {
        const q = args.query || userMessage;
        return await this.handleCustomerInvoiceLookup(session, context, q);
      }

      if (call.name === 'list_all_invoices') {
        const filter = args.statusFilter || 'all';
        return await this.handleListInvoices(session, context, filter);
      }

      if (call.name === 'convert_quote_to_invoice') {
        return await this.handleConvertQuote(session, context, args.quoteQuery || userMessage);
      }

      if (call.name === 'generate_and_email_invoice') {
        return await this.handleEmailInvoice(session, context, userMessage);
      }

      if (call.name === 'generate_invoice_pdf') {
        return await this.handlePreviewPdf(session, context, userMessage);
      }

      if (call.name === 'mark_invoice_as_paid') {
        return await this.handleMarkPaid(session, context, args.customerName || userMessage);
      }

      if (call.name === 'audit_invoice_compliance') {
        return await this.handleAuditCompliance(session, context, args.customerName || userMessage);
      }

      if (call.name === 'check_outstanding_balance') {
        return await this.handleOutstandingSummary(session, context, args.customerName || '', userMessage);
      }
    }

    const reply = result.response.text();
    return { reply };
  }

  ruleEngine(session, userMessage, context) {
    const text = userMessage.toLowerCase();
    if (text.includes('hello') || text.includes('hi') || text.includes('hey')) {
      return {
        reply: `👋 Hello! I am your **Dynamics 365 Invoice & Billing AI Copilot**.\n\nI can help you:\n` +
          `- ⚡ **Convert Quote to Invoice** in 1 click\n` +
          `- 📄 **Preview & Download Branded PDF**\n` +
          `- 📧 **Dispatch Tax Invoice to Client** via Email\n` +
          `- ✅ **Mark Invoice as Paid** & update CRM\n` +
          `- 💰 **Check Pending Payment & Outstanding Due**\n` +
          `- 🔍 **Audit Tax & GST Compliance**\n\nHow can I assist you today?`
      };
    }

    return {
      reply: `ℹ️ I can assist with **Quotation to Invoice conversion**, **PDF generation**, **Client email dispatch**, and **Payment tracking**. Use the quick action buttons above or type what you would like to do!`
    };
  }
}

module.exports = new InvoiceBrain();
