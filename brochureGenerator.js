const PDFDocument = require('pdfkit');

/**
 * Generate a professional Product Brochure PDF as a Buffer
 */
function generateBrochurePDF(customerName = 'Valued Customer') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // ── Header Bar ──
    doc.rect(0, 0, doc.page.width, 90).fill('#4f46e5');
    doc.fillColor('#ffffff')
       .font('Helvetica-Bold')
       .fontSize(24)
       .text('CloudScale Tech Solutions', 50, 25);
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor('#c7d2fe')
       .text('Microsoft Dynamics 365 | AI Sales Automation | CRM Integration', 50, 56);

    doc.moveDown(3);

    // ── Welcome Line ──
    doc.fillColor('#1e293b')
       .font('Helvetica-Bold')
       .fontSize(14)
       .text(`Dear ${customerName},`, 50, 110);

    doc.font('Helvetica')
       .fontSize(11)
       .fillColor('#334155')
       .text(
         'Thank you for your interest in CloudScale Tech Solutions. Please find below our complete\n' +
         'Product Catalog & Pricing Guide (2026 Edition) tailored for modern enterprises.',
         50, 135, { width: 500 }
       );

    // ── Divider ──
    doc.moveTo(50, 185).lineTo(545, 185).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.5);

    // ── Section Title ──
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#4f46e5')
       .text('Our Packages', 50, 200);

    // ── Package 1 ──
    doc.rect(50, 225, 495, 100).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#4f46e5')
       .text('Starter AI Package', 65, 238);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#10b981')
       .text('$60 / month  (₹4,999/mo)', 65, 258);
    doc.font('Helvetica').fontSize(10).fillColor('#475569')
       .text('• Basic Sales Chatbot & Web Widget', 65, 278)
       .text('• Up to 1,000 inquiries/month', 65, 293)
       .text('• Email Notifications & Lead Capture', 65, 308);

    // ── Package 2 ──
    doc.rect(50, 338, 495, 110).fillAndStroke('#eff6ff', '#bfdbfe');
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1d4ed8')
       .text('Growth Business Suite', 65, 352);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#10b981')
       .text('$180 / month  (₹14,999/mo)', 65, 372);
    doc.font('Helvetica').fontSize(10).fillColor('#475569')
       .text('• Full 2-way Microsoft Dynamics 365 / Dataverse Sync', 65, 392)
       .text('• WhatsApp Business Integration', 65, 407)
       .text('• Lead Scoring, Meeting Scheduler & Pipeline Reports', 65, 422);

    // ── Package 3 ──
    doc.rect(50, 462, 495, 110).fillAndStroke('#faf5ff', '#e9d5ff');
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#7c3aed')
       .text('Enterprise Custom Suite', 65, 476);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#10b981')
       .text('Custom Pricing (Volume-based Contract)', 65, 496);
    doc.font('Helvetica').fontSize(10).fillColor('#475569')
       .text('• Multi-agent Pipeline Automation', 65, 516)
       .text('• Dedicated Cloud Tenant & Custom Dataverse Entity Mapping', 65, 531)
       .text('• 24/7 SLA, Priority Support & Onboarding', 65, 546);

    // ── Why CloudScale ──
    doc.moveTo(50, 590).lineTo(545, 590).strokeColor('#e2e8f0').stroke();
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#4f46e5')
       .text('Why CloudScale?', 50, 600);
    doc.font('Helvetica').fontSize(10).fillColor('#334155')
       .text('✔  Native Microsoft Dynamics 365 & Azure Integration', 65, 622)
       .text('✔  OpenAI GPT-4o Powered Sales Copilot', 65, 638)
       .text('✔  Real-time Lead Sync to CRM from any Channel', 65, 654)
       .text('✔  Auto PDF Brochure Dispatch via AI Agent', 65, 670)
       .text('✔  Multi-language Support (English, Gujarati, Hindi)', 65, 686);

    // ── Footer ──
    doc.rect(0, doc.page.height - 60, doc.page.width, 60).fill('#1e293b');
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(9)
       .text('CloudScale Tech Solutions  |  sales@cloudscale.ai  |  +91 98250 00000', 50, doc.page.height - 42)
       .text('Connected with Microsoft Dynamics 365 Sales Hub  |  © 2026 All Rights Reserved', 50, doc.page.height - 27);

    doc.end();
  });
}

module.exports = { generateBrochurePDF };
