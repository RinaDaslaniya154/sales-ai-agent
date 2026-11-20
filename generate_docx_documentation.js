const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  WidthType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  PageBreak,
  ShadingType,
} = require('docx');

// Image paths
const robotLogoPath = 'C:/Users/webtual/Desktop/robot_clean.png';
const archPath = 'C:/Users/webtual/.gemini/antigravity/brain/55d3f978-b593-44d3-ac6b-8ff197435410/.user_uploaded/media_1795084707845_a4e89d70.jpg';
const fullScreenPath = 'C:/Users/webtual/.gemini/antigravity/brain/55d3f978-b593-44d3-ac6b-8ff197435410/.user_uploaded/media_1795089395974_1e52648a.jpg';
const closeChatPath = 'C:/Users/webtual/.gemini/antigravity/brain/55d3f978-b593-44d3-ac6b-8ff197435410/.user_uploaded/media_1795089426399_378c9b71.png';

function getImgRun(filePath, width, height) {
  if (fs.existsSync(filePath)) {
    return new ImageRun({
      data: fs.readFileSync(filePath),
      transformation: { width, height },
    });
  }
  return new TextRun({ text: '[Image Attached in Solution Bundle]', italics: true, color: '64748B' });
}

// Styling Constants
const PRIMARY_BLUE = '0078D4';
const NAVY_HEADING = '0F172A';
const BODY_TEXT = '334155';
const BORDER_COLOR = 'CBD5E1';
const TABLE_BG_LIGHT = 'F8FAFC';
const BRAND_SKY = '0284C7';

const thinBorder = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: BORDER_COLOR,
};

const cellBorders = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
};

function createHeaderCell(text, widthPercent = 25) {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    shading: { fill: PRIMARY_BLUE, type: ShadingType.CLEAR },
    borders: cellBorders,
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 100, after: 100 },
        children: [
          new TextRun({
            text: text,
            bold: true,
            color: 'FFFFFF',
            size: 19, // 9.5pt
            font: 'Segoe UI',
          }),
        ],
      }),
    ],
  });
}

function createDataCell(text, bold = false, widthPercent = 25, isHighlight = false) {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    shading: isHighlight ? { fill: TABLE_BG_LIGHT, type: ShadingType.CLEAR } : undefined,
    borders: cellBorders,
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 80, after: 80 },
        children: [
          new TextRun({
            text: text,
            bold: bold,
            color: isHighlight ? NAVY_HEADING : BODY_TEXT,
            size: 18, // 9pt
            font: 'Segoe UI',
          }),
        ],
      }),
    ],
  });
}

function pHeading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    keepWithNext: true,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text: text,
        bold: true,
        size: 30, // 15pt
        color: NAVY_HEADING,
        font: 'Segoe UI',
      }),
    ],
  });
}

function pHeading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepWithNext: true,
    spacing: { before: 180, after: 90 },
    children: [
      new TextRun({
        text: text,
        bold: true,
        size: 24, // 12pt
        color: PRIMARY_BLUE,
        font: 'Segoe UI',
      }),
    ],
  });
}

function pBody(text, bold = false) {
  return new Paragraph({
    spacing: { before: 60, after: 80, line: 260 },
    children: [
      new TextRun({
        text: text,
        bold: bold,
        size: 20, // 10pt
        color: BODY_TEXT,
        font: 'Segoe UI',
      }),
    ],
  });
}

function pBullet(text, boldPrefix = '') {
  const children = [];
  if (boldPrefix) {
    children.push(
      new TextRun({
        text: boldPrefix + ' ',
        bold: true,
        size: 20,
        color: NAVY_HEADING,
        font: 'Segoe UI',
      })
    );
  }
  children.push(
    new TextRun({
      text: text,
      size: 20,
      color: BODY_TEXT,
      font: 'Segoe UI',
    })
  );

  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 40, after: 60, line: 250 },
    children: children,
  });
}

const doc = new Document({
  styles: {
    default: {
      document: {
        run: {
          font: 'Segoe UI',
          size: 20,
          color: BODY_TEXT,
        },
        paragraph: {
          spacing: { line: 260 },
        },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 900, bottom: 900, left: 1000, right: 1000 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: 'Webtual Technology  |  Dynamics 365 Sales & Invoice AI Suite',
                  size: 16,
                  color: '94A3B8',
                  font: 'Segoe UI',
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.SPACE_BETWEEN,
              children: [
                new TextRun({
                  text: 'Product Solution Document  |  https://webtual.com',
                  size: 16,
                  color: '94A3B8',
                  font: 'Segoe UI',
                }),
                new TextRun({
                  children: ['   Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                  size: 16,
                  color: '94A3B8',
                  font: 'Segoe UI',
                }),
              ],
            }),
          ],
        }),
      },
      children: [
        // ================= PAGE 1 =================
        // Clean Robot Illustration (No Cut Text)
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 140, after: 100 },
          children: [getImgRun(robotLogoPath, 110, 99)],
        }),

        // Document Title
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 40 },
          children: [
            new TextRun({
              text: 'Webtual Sales & Invoice AI Suite',
              bold: true,
              size: 36, // 18pt
              color: NAVY_HEADING,
              font: 'Segoe UI',
            }),
          ],
        }),

        // Subtitle
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: 'Enterprise Autonomous AI Solution for Microsoft Dynamics 365 Sales Hub',
              bold: true,
              size: 22, // 11pt
              color: BRAND_SKY,
              font: 'Segoe UI',
            }),
          ],
        }),

        // Metadata Bar with Version 1.0.0
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 260 },
          children: [
            new TextRun({
              text: 'Author: Webtual Technology (Enterprise AI Practice)   |   Version: 1.0.0   |   Platform: Dynamics 365 & Microsoft Dataverse',
              size: 17,
              color: '64748B',
              font: 'Segoe UI',
            }),
          ],
        }),

        // 1. EXECUTIVE SUMMARY
        pHeading1('1. Executive Summary: What Does This AI Agent Actually Do?'),
        pBody(
          'In standard CRM environments, sales and finance teams waste over 65% of their working hours performing repetitive administrative tasks. Sellers must manually research lead histories, compose follow-up emails, format PDF brochures, advance CRM stages, and key in line-item invoice records into Microsoft Dataverse.'
        ),
        pBody(
          'While standard conversational assistants (such as default Microsoft Copilot) can summarize text, they are fundamentally read-only—they cannot execute transactional actions in your CRM.'
        ),
        pBody(
          'Webtual Sales & Invoice AI Suite is an Action-Driven Autonomous AI Agent embedded natively inside Microsoft Dynamics 365 Sales Hub. It empowers users to complete complex CRM and financial workflows in seconds using natural conversation:'
        ),
        pBullet(
          'Automatically reads the open lead or opportunity (Name, Company, Email) without copy-pasting, generating a 3-bullet history briefing in 2 seconds.',
          'Contextual Lead Briefings:'
        ),
        pBullet(
          'User types "Send brochure to client" -> Backend compiles a branded vector PDF with customer-specific pricing and dispatches it via SMTP directly to the customer in 3 seconds.',
          'Dynamic Vector PDF & Email Dispatch:'
        ),
        pBullet(
          'User types "Qualify this lead" -> AI validates Dataverse fields, updates state code, and advances the Business Process Flow stage automatically.',
          '1-Click Natural Language Lead Qualification:'
        ),
        pBullet(
          'Converts quotes to official Dataverse invoices, computes line-item taxes/discounts, creates official invoice records, renders PDF, and emails billing contacts.',
          'Autonomous Invoice Creation (Finance Agent):'
        ),
        pBullet(
          'Sales reps schedule follow-up tasks and calendar meetings directly through conversational chat without leaving the lead form.',
          'Appointment & Task Scheduling:'
        ),

        // PAGE BREAK TO PAGE 2
        new Paragraph({ children: [new PageBreak()] }),

        // ================= PAGE 2 =================
        // 2. BEFORE VS AFTER TABLE
        pHeading1('2. Before vs. After: Real-World Productivity & Time Savings'),
        pBody(
          'The table below demonstrates the concrete operational time saved per deal using the Webtual AI Suite:'
        ),

        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                createHeaderCell('Workflow Task', 28),
                createHeaderCell('Traditional Manual Process', 26),
                createHeaderCell('With Webtual AI Agent', 26),
                createHeaderCell('Time Saved', 20),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Lead History & Timeline Review', true, 28),
                createDataCell('10 – 15 minutes manual reading', false, 26),
                createDataCell('2 seconds (Context briefing)', false, 26, true),
                createDataCell('98% Faster', true, 20, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('PDF Brochure Creation & Emailing', true, 28),
                createDataCell('15 – 20 mins (Word/PPT + Outlook)', false, 26),
                createDataCell('3 seconds (Auto-render + SMTP)', false, 26, true),
                createDataCell('99% Faster', true, 20, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Lead Qualification & BPF Advance', true, 28),
                createDataCell('3 – 5 mins across multiple tabs', false, 26),
                createDataCell('2 seconds (Natural language)', false, 26, true),
                createDataCell('90% Faster', true, 20, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Dataverse Invoicing & Tax Calculation', true, 28),
                createDataCell('20 – 30 mins manual data entry', false, 26),
                createDataCell('5 seconds (Dataverse + PDF)', false, 26, true),
                createDataCell('97% Faster', true, 20, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Total Administrative Time Per Deal', true, 28, true),
                createDataCell('~50 Minutes', true, 26, true),
                createDataCell('< 15 Seconds', true, 26, true),
                createDataCell('Save 3+ Hrs/Day', true, 20, true),
              ],
            }),
          ],
        }),

        // 3. COPILOT VS WEBTUAL BATTLE CARD
        pHeading1('3. Webtual AI Agent vs. Microsoft Copilot for Sales'),
        pBody(
          'Clients frequently inquire why they should deploy Webtual AI Agent instead of standard Microsoft Copilot for Sales. The comparison below highlights the decisive operational differences:'
        ),

        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              cantSplit: true,
              children: [
                createHeaderCell('Feature / Capability', 30),
                createHeaderCell('Microsoft Copilot for Sales', 35),
                createHeaderCell('Webtual AI Agent Suite', 35),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Transactional Invoicing in Dataverse', true, 30),
                createDataCell('Unsupported (Advisory text only)', false, 35),
                createDataCell('1-Click Full Invoicing (Creates real records in Dataverse)', true, 35, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Dynamic Branded PDF Brochure', true, 30),
                createDataCell('Unsupported', false, 35),
                createDataCell('Dynamically generated vector PDF with client pricing', true, 35, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Autonomous Email Dispatch', true, 30),
                createDataCell('Drafts text in Outlook only (Manual send)', false, 35),
                createDataCell('Direct SMTP delivery with attached PDF + CRM log', true, 35, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Dynamics 365 Navigation Bar Placement', true, 30),
                createDataCell('Native Top-Bar Pill', false, 35),
                createDataCell('Injected right next to Copilot (#d365-topbar-sales-ai-btn)', true, 35, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Docked Side Pane (440px Squeeze)', true, 30),
                createDataCell('Supported (Built-in)', false, 35),
                createDataCell('Supported (Auto-squeezes CRM form without hiding fields)', true, 35, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Zero-Credit Outage Protection', true, 30),
                createDataCell('Fails when credits expire (Error code EnforcementUsageCredits)', false, 35),
                createDataCell('Dual Engine: GPT-4o + Gemini sub-second auto-fallback', true, 35, true),
              ],
            }),
            new TableRow({
              cantSplit: true,
              children: [
                createDataCell('Pricing & Licensing Model', true, 30),
                createDataCell('$50 / User / Month ($600/year per user recurring)', false, 35),
                createDataCell('Predictable Team Flat Fee (Save 60% to 75% annually)', true, 35, true),
              ],
            }),
          ],
        }),

        // PAGE BREAK TO PAGE 3
        new Paragraph({ children: [new PageBreak()] }),

        // ================= PAGE 3 =================
        // 4. LIVE PRODUCT SHOWCASE (PART A - FULL SCREEN)
        pHeading1('4. Live Product Showcase & UI Integration'),
        pBody(
          'Below is an authentic deployment view inside Microsoft Dynamics 365 Sales Hub showing the live active lead context and the embedded Sales AI Agent:'
        ),

        pHeading2('Figure 1: Full Dynamics 365 Lead Form Canvas with Embedded Sales AI Agent'),
        pBody(
          'Demonstrates the seamless integration into Dynamics 365 Sales Hub. The Sales AI Agent is docked on the right, maintaining continuous two-way synchronization with the active lead record ("Abhi Viramgama - Webtual"):'
        ),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 140 },
          children: [getImgRun(fullScreenPath, 560, 259)],
        }),
        pBullet(
          'Displays active lead context ("Abhi Viramgama - Webtual Synced") automatically without manual copy-pasting.',
          'Zero-Click Lead Synchronization:'
        ),
        pBullet(
          'Placed beside Microsoft Copilot in the global dark-blue shell header for one-click access.',
          'Native Header Bar Neighbor:'
        ),
        pBullet(
          'Auto-squeezes the central CRM form so the seller can read customer history while chatting with the AI.',
          'Non-Intrusive Form Layout:'
        ),

        // PAGE BREAK TO PAGE 4
        new Paragraph({ children: [new PageBreak()] }),

        // ================= PAGE 4 =================
        // 4. LIVE PRODUCT SHOWCASE (PART B - CLOSE-UP CHAT)
        pHeading2('Figure 2: Conversational Action Execution & Real-Time CRM Operations'),
        pBody(
          'Close-up view demonstrating live conversational executions: Lead lookup, instant qualification to Opportunity, pipeline status querying, and automatic product brochure compilation and email delivery:'
        ),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 120 },
          children: [getImgRun(closeChatPath, 250, 466)],
        }),

        // PAGE BREAK TO PAGE 5
        new Paragraph({ children: [new PageBreak()] }),

        // ================= PAGE 5 =================
        // 5. HYBRID ARCHITECTURE & RESILIENCE
        pHeading1('5. Enterprise Hybrid Architecture & High Availability'),
        pBody(
          'The solution is architected with a dual-engine AI pipeline that guarantees continuous 99.99% operational uptime without vendor lock-in or quota lockouts:'
        ),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 140 },
          children: [getImgRun(archPath, 520, 295)],
        }),

        pBullet(
          'User conversational queries are classified in real time into informational requests vs transactional CRM actions.',
          'Smart AI Query Classifier:'
        ),
        pBullet(
          'OpenAI GPT-4o operates as the primary high-reasoning engine for complex multi-step Dataverse actions.',
          'Primary Engine (OpenAI GPT-4o):'
        ),
        pBullet(
          'Google Gemini operates as an automated sub-50ms fallback engine if OpenAI encounters rate limits (HTTP 429) or token exhaustion.',
          'Automated Zero-Cost Failover:'
        ),
        pBullet(
          'Communicates securely via @azure/msal-node OAuth2 Client Credentials flow, respecting Dataverse role-based security.',
          'Microsoft Dataverse Web API:'
        ),

        // 6. KEY AUTONOMOUS WORKFLOWS
        pHeading1('6. Comprehensive Business Workflows Delivered'),
        pBullet(
          'Dynamic Vector PDF compilation with client-specific pricing tables, auto-dispatched via TLS SMTP with automatic Dynamics 365 activity logging.',
          'Dynamic Collateral & Quotation Engine:'
        ),
        pBullet(
          'Generates official commercial tax invoices with GST calculation directly from Quote line items, saving 25+ minutes per deal.',
          'Autonomous Invoicing Agent (Finance Module):'
        ),
        pBullet(
          'Advances Business Process Flow stages, updates Lead state to Qualified, and creates corresponding Opportunities automatically.',
          '1-Click Natural Language Lead Qualification:'
        ),
        pBullet(
          'Instant 3-bullet executive briefing synthesized from past emails, phone calls, and annotation records in 2 seconds.',
          'Contextual Timeline Synthesis:'
        ),
        pBullet(
          'Sales reps schedule follow-up tasks and calendar appointments directly from conversational chat.',
          'Appointment & Task Scheduling:'
        ),

        // 7. CORPORATE PROFILE
        pHeading1('7. About Webtual Technology'),
        pBody(
          'Webtual Technology is an enterprise technology consulting and software engineering firm specializing in Artificial Intelligence automation, Microsoft Dynamics 365 implementations, Power Platform solutions, and cloud architectures.'
        ),
        pBullet('https://webtual.com', 'Website:'),
        pBullet('Enterprise AI & Business Applications Practice', 'Practice Area:'),
        pBullet('info@webtual.com', 'Contact Email:'),
        pBullet('Microsoft Dynamics 365 & Dataverse Partner Ecosystem', 'Specialization:'),
      ],
    },
  ],
});

const outputPathDesktop = 'C:/Users/webtual/Desktop/Webtual_Sales_AI_Agent_Showcase.docx';
const outputPathProject = path.join(__dirname, 'Webtual_Dynamics365_AI_Agent_Documentation.docx');
const fallbackPath = path.join(__dirname, 'Webtual_Dynamics365_AI_Agent_Documentation_v2.0.docx');

Packer.toBuffer(doc)
  .then((buffer) => {
    try {
      fs.writeFileSync(outputPathDesktop, buffer);
      console.log('Successfully saved to Desktop:', outputPathDesktop);
    } catch (e) {
      const desktopFallback = 'C:/Users/webtual/Desktop/Webtual_Sales_AI_Agent_Showcase_New.docx';
      fs.writeFileSync(desktopFallback, buffer);
      console.log('Desktop file locked, saved to:', desktopFallback);
    }

    try {
      fs.writeFileSync(outputPathProject, buffer);
      console.log('Successfully saved to Project:', outputPathProject);
    } catch (e) {
      const ts = Date.now();
      const projectFallback = path.join(__dirname, `Webtual_Sales_AI_Agent_Showcase_${ts}.docx`);
      fs.writeFileSync(projectFallback, buffer);
      console.log('Project file was open, saved to:', projectFallback);
    }
  })
  .catch((err) => {
    console.error('Error generating document:', err);
    process.exit(1);
  });
