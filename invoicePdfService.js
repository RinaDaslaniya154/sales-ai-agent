const PDFDocument = require('pdfkit');

/**
 * Generate a modern, ultra-clean corporate Tax Invoice PDF
 */
function generateInvoicePDF(invoiceData = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const {
      invoiceNumber = 'INV-' + Date.now().toString().slice(-6),
      customerName = 'Valued Customer',
      company = 'Webtual Technology',
      email = 'customer@example.com',
      date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      dueDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      currency = '₹',
      currencyCode = 'INR',
      items = [
        { description: 'Enterprise AI Suite - Annual Plan (5 Users)', qty: 5, unitPrice: 4999, total: 24995 },
        { description: 'Dynamics 365 Dataverse Integration & Setup', qty: 1, unitPrice: 8000, total: 8000 }
      ],
      discountPercent = Number(invoiceData.discountPercent || invoiceData.discountpercentage || 0),
      taxPercent = 18,
      status = 'ACTIVE'
    } = invoiceData;

    const curSymbol = 'Rs. ';

    // Financial calculations — Strictly synchronized with Microsoft Dynamics 365
    const subtotal = (invoiceData.totallineitemamount !== undefined && invoiceData.totallineitemamount !== null && Number(invoiceData.totallineitemamount) > 0)
      ? Number(invoiceData.totallineitemamount)
      : items.reduce((acc, it) => acc + (Number(it.total) || (Number(it.qty) * Number(it.unitPrice)) || 0), 0);

    const discountAmount = (invoiceData.totaldiscountamount !== undefined && invoiceData.totaldiscountamount !== null && Number(invoiceData.totaldiscountamount) > 0)
      ? Number(invoiceData.totaldiscountamount)
      : Math.round((subtotal * discountPercent) / 100);

    const taxableAmount = subtotal - discountAmount;

    const taxAmount = (invoiceData.totaltax !== undefined && invoiceData.totaltax !== null && Number(invoiceData.totaltax) > 0)
      ? Number(invoiceData.totaltax)
      : Math.round((taxableAmount * taxPercent) / 100);

    const grandTotal = (invoiceData.totalamount !== undefined && invoiceData.totalamount !== null && Number(invoiceData.totalamount) > 0)
      ? Number(invoiceData.totalamount)
      : (taxableAmount + taxAmount);

    // ── Top Brand Header (Clean Modern SaaS Look) ──
    doc.rect(0, 0, doc.page.width, 4).fill('#4f46e5');

    // Left: Company Logo / Name
    doc.fillColor('#4f46e5')
       .font('Helvetica-Bold')
       .fontSize(22)
       .text('CloudScale AI', 45, 36);
    
    doc.font('Helvetica')
       .fontSize(8.5)
       .fillColor('#64748b')
       .text('CloudScale Tech Solutions Ltd.', 45, 62)
       .text('Regd: 504 Tech Tower, SG Highway, Ahmedabad, Gujarat', 45, 74)
       .text('GSTIN: 24AAACC1234F1Z5  |  PAN: AABCC1234F', 45, 86);

    // Right: Invoice Metadata
    doc.fillColor('#0f172a')
       .font('Helvetica-Bold')
       .fontSize(22)
       .text('TAX INVOICE', doc.page.width - 245, 36, { align: 'right', width: 200 });
    
    doc.font('Helvetica')
       .fontSize(8.5)
       .fillColor('#64748b')
       .text(`Invoice No: #${invoiceNumber}`, doc.page.width - 245, 62, { align: 'right', width: 200 })
       .text(`Issue Date: ${date}`, doc.page.width - 245, 74, { align: 'right', width: 200 })
       .text(`Due Date: ${dueDate}`, doc.page.width - 245, 86, { align: 'right', width: 200 });

    // Status Pill
    const isPaid = status === 'PAID';
    const pillBg = isPaid ? '#dcfce7' : '#e0e7ff';
    const pillText = isPaid ? '#15803d' : '#4338ca';
    doc.roundedRect(doc.page.width - 125, 102, 80, 18, 9).fill(pillBg);
    doc.fillColor(pillText).font('Helvetica-Bold').fontSize(8)
       .text(isPaid ? 'PAID / CLOSED' : 'ACTIVE / CRM', doc.page.width - 125, 107, { align: 'center', width: 80 });

    // ── Two Side-by-Side Cards: ISSUED BY vs BILLED TO ──
    const cardY = 130;
    const cardW = 245;
    const cardH = 82;

    // Card 1: ISSUED BY
    doc.roundedRect(45, cardY, cardW, cardH, 8).fill('#f8fafc').strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8).text('ISSUED BY', 58, cardY + 10);
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text('CloudScale Tech Solutions', 58, cardY + 23);
    doc.fillColor('#475569').font('Helvetica').fontSize(8.5)
       .text('Ahmedabad, Gujarat, India', 58, cardY + 39)
       .text('Email: billing@cloudscale.ai', 58, cardY + 52)
       .text('Phone: +91 98250 00000', 58, cardY + 65);

    // Card 2: BILLED TO
    doc.roundedRect(305, cardY, cardW, cardH, 8).fill('#f8fafc').strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.fillColor('#4f46e5').font('Helvetica-Bold').fontSize(8).text('BILLED TO (CLIENT)', 318, cardY + 10);
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(customerName, 318, cardY + 23);
    doc.fillColor('#475569').font('Helvetica').fontSize(8.5)
       .text(company ? `Organization: ${company}` : 'Client: Direct Account', 318, cardY + 39)
       .text(`Email: ${email}`, 318, cardY + 52)
       .text(`Currency: Indian Rupee (${currencyCode})`, 318, cardY + 65);

    // ── Line Items Table ──
    const tableTop = 228;
    const tableW = doc.page.width - 90;

    // Header Bar
    doc.roundedRect(45, tableTop, tableW, 26, 6).fill('#f1f5f9');
    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8.5);
    doc.text('Description / Service Item', 58, tableTop + 8, { width: 240 });
    doc.text('Qty', 305, tableTop + 8, { width: 35, align: 'center' });
    doc.text('Unit Price', 350, tableTop + 8, { width: 90, align: 'right' });
    doc.text('Amount', 450, tableTop + 8, { width: 88, align: 'right' });

    // Table Rows
    let currentY = tableTop + 28;
    items.forEach((item, index) => {
      const itemDesc = item.description || `Item #${index + 1}`;
      const itemQty = item.qty || 1;
      const itemUnitPrice = Number(item.unitPrice || 0).toLocaleString('en-IN');
      const itemTotal = Number(item.total || (itemQty * item.unitPrice)).toLocaleString('en-IN');

      doc.fillColor('#0f172a').font('Helvetica').fontSize(8.8)
         .text(itemDesc, 58, currentY + 7, { width: 240 })
         .text(String(itemQty), 305, currentY + 7, { width: 35, align: 'center' })
         .text(`${curSymbol}${itemUnitPrice}`, 350, currentY + 7, { width: 90, align: 'right' })
         .font('Helvetica-Bold')
         .text(`${curSymbol}${itemTotal}`, 450, currentY + 7, { width: 88, align: 'right' });

      // Separator
      doc.moveTo(45, currentY + 26).lineTo(45 + tableW, currentY + 26).strokeColor('#f1f5f9').lineWidth(1).stroke();
      currentY += 28;
    });

    // ── Financial Breakdown (Right-Aligned) ──
    currentY += 12;
    const totalsX = 325;
    const totalsW = 225;

    const printLine = (label, value, y, isRed = false) => {
      doc.fillColor('#64748b').font('Helvetica').fontSize(9).text(label, totalsX, y);
      doc.fillColor(isRed ? '#dc2626' : '#0f172a').font('Helvetica-Bold').fontSize(9)
         .text(value, totalsX, y, { align: 'right', width: totalsW });
    };

    let lineOffset = 0;
    printLine('Subtotal:', `${curSymbol}${subtotal.toLocaleString('en-IN')}`, currentY);
    if (discountAmount > 0) {
      lineOffset += 17;
      printLine(`Discount (${discountPercent}%):`, `- ${curSymbol}${discountAmount.toLocaleString('en-IN')}`, currentY + lineOffset, true);
    }
    lineOffset += 17;
    printLine(`GST / Tax (${taxPercent}%):`, `+ ${curSymbol}${taxAmount.toLocaleString('en-IN')}`, currentY + lineOffset);

    doc.moveTo(totalsX, currentY + lineOffset + 18).lineTo(totalsX + totalsW, currentY + lineOffset + 18).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // Total Payable
    const pillY = currentY + lineOffset + 24;
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(11)
       .text('Total Payable:', totalsX + 4, pillY + 8);
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(12)
       .text(`${curSymbol}${grandTotal.toLocaleString('en-IN')}`, totalsX + 4, pillY + 7, { align: 'right', width: totalsW - 8 });

    // ── Row: Bank Details (Left) & Authorized Signatory (Right) ──
    const bottomSectionY = currentY + 82;
    const boxH = 92;

    // Left: Bank Transfer Details Box
    const bankW = 275;
    doc.roundedRect(45, bottomSectionY, bankW, boxH, 8).fill('#f8fafc').strokeColor('#e2e8f0').lineWidth(1).stroke();
    
    doc.fillColor('#4f46e5').font('Helvetica-Bold').fontSize(8.5)
       .text('PAYMENT DETAILS & BANK TRANSFER', 58, bottomSectionY + 11);
    
    doc.fillColor('#475569').font('Helvetica').fontSize(8.2)
       .text('Bank Name: HDFC Bank Ltd.', 58, bottomSectionY + 26)
       .text('Account Name: CloudScale Tech Solutions Ltd.', 58, bottomSectionY + 38)
       .text('Account No: 50200088992211', 58, bottomSectionY + 50)
       .text('IFSC Code: HDFC0000240', 58, bottomSectionY + 62)
       .text('UPI ID: cloudscale@hdfcbank', 58, bottomSectionY + 74);

    // Right: Authorized Signatory Box
    const stampX = 335;
    const stampW = doc.page.width - 45 - stampX;
    doc.roundedRect(stampX, bottomSectionY, stampW, boxH, 8).fill('#f8fafc').strokeColor('#e2e8f0').lineWidth(1).stroke();
    
    doc.fillColor('#4f46e5').font('Helvetica-Bold').fontSize(11)
       .text('CloudScale AI', stampX + 16, bottomSectionY + 13);
    
    doc.fillColor('#10b981').font('Helvetica-Bold').fontSize(8)
       .text('● [VERIFIED] Digital CRM Seal', stampX + 16, bottomSectionY + 30);
    
    doc.fillColor('#64748b').font('Helvetica').fontSize(7.5)
       .text('Issued via Microsoft Dynamics 365', stampX + 16, bottomSectionY + 45);

    doc.moveTo(stampX + 16, bottomSectionY + 62).lineTo(stampX + stampW - 16, bottomSectionY + 62).strokeColor('#cbd5e1').lineWidth(0.8).stroke();

    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8.5)
       .text('Authorized Signatory', stampX + 16, bottomSectionY + 70);

    // ── Bottom: Terms & Conditions (Moved Below Bank Details & Signatory) ──
    const termsY = bottomSectionY + boxH + 12;
    doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7.8).text('TERMS & CONDITIONS:', 45, termsY);
    doc.fillColor('#64748b').font('Helvetica').fontSize(7.2)
       .text('1. Payment is due within 7 days of invoice date.', 45, termsY + 12)
       .text('2. Computer-generated tax invoice verified via Microsoft Dynamics 365 Sales.', 45, termsY + 23)
       .text('3. Software subscriptions are provisioned immediately upon payment confirmation.', 45, termsY + 34);

    // Footer
    const footerY = doc.page.height - 30;
    doc.moveTo(45, footerY - 8).lineTo(doc.page.width - 45, footerY - 8).strokeColor('#f1f5f9').lineWidth(1).stroke();
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(7.5)
       .text('Generated via Microsoft Dynamics 365 Sales AI Copilot  |  billing@cloudscale.ai  |  www.cloudscale.ai', 45, footerY, { align: 'center', width: doc.page.width - 90 });

    doc.end();
  });
}

module.exports = {
  generateInvoicePDF
};
