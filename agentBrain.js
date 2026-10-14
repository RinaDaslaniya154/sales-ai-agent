const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dynamicsService = require('./dynamicsService');
const emailService = require('./emailService');
require('dotenv').config();

// Internal Sales Knowledge & Product Catalog for Sales Executives & Admins
const SALES_TEAM_PLAYBOOK = `
Organization: CloudScale Tech Solutions
CRM System: Microsoft Dynamics 365 Sales Hub
Target Audience: Internal Sales Executives, Account Managers, Sales Managers, and CRM Administrators.

Company Product Packages:
1. Starter AI Package:
   - Price: $60 / month (₹4,999/mo)
   - Scope: Basic Sales Chatbot, Web Widget, up to 1,000 inquiries/mo, Email Notifications.
2. Growth Business Suite:
   - Price: $180 / month (₹14,999/mo)
   - Scope: Complete 2-way Microsoft Dynamics 365 / Dataverse sync, WhatsApp Business integration, Lead Scoring, Meeting Scheduler.
3. Enterprise Custom Suite:
   - Price: Custom contract based on volume
   - Scope: Multi-agent pipeline automation, dedicated cloud tenant, custom Dataverse entity mapping, 24/7 SLA.

Internal Assistant Directives:
- You are the dedicated internal Dynamics 365 Sales Copilot for sales team members and admins.
- When a sales rep gives details of a call or meeting, immediately create the lead in Dynamics 365 using 'save_lead_to_dynamics'.
- When a sales rep asks about past conversations, client notes, or timeline history, query Dynamics 365 via 'query_dynamics_lead_history'.
- When a sales rep instructs you to email or send the brochure/catalog/sales kit to a prospect or lead (e.g. "send brochure to Rina Patel"), trigger 'send_product_brochure_email'.
- When the user does NOT explicitly specify a different person by name, ALWAYS use the active open lead from [Current Dynamics 365 Lead Context]. NEVER reuse older lead names from prior chat turns.
- Always respond professionally, concisely, and efficiently as an enterprise sales colleague.
`;

class AgentBrain {
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

    this.isOpenAIConfigured = this.isGemini || this.isOpenAI;

    if (this.isGemini) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      this.modelName = 'gemini-3.1-flash-lite';
      console.log('✅ Google Gemini AI Connected (Model: gemini-3.1-flash-lite).');
    } else if (this.isOpenAI) {
      this.openai = new OpenAI({ apiKey: this.apiKey });
      this.modelName = 'gpt-4o-mini';
      console.log('✅ OpenAI GPT-4o Engine Connected for Sales Team Copilot (Model: gpt-4o-mini).');
    } else {
      console.log('ℹ️ Running Built-in Smart Sales Team Rule Engine.');
    }

    this.sessions = new Map();
  }

  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'save_lead_to_dynamics',
          description: 'Record a new customer lead or phone inquiry directly into Microsoft Dynamics 365 Sales Hub.',
          parameters: {
            type: 'object',
            properties: {
              fullname: {
                type: 'string',
                description: 'Full name of the client/prospect',
              },
              email: {
                type: 'string',
                description: 'Email address of the client',
              },
              phone: {
                type: 'string',
                description: 'Contact phone number of the client',
              },
              company: {
                type: 'string',
                description: 'Company name or organization',
              },
              requirement: {
                type: 'string',
                description: 'Call notes, package interest, or inquiry description',
              },
            },
            required: ['fullname', 'email'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'query_dynamics_lead_history',
          description: 'Search Microsoft Dynamics 365 CRM to fetch past conversation logs, timeline notes, or contact info about a client or company.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Company name, client name, or email to search in Dynamics 365',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'send_product_brochure_email',
          description: 'Dispatch or send the official Product Brochure PDF and Pricing Guide to a prospect or lead. Use this whenever the user asks to send, email, or mail a brochure or catalog. Accepts customerName (prospect name like "Rina Patel") or email (or both). The system will automatically look up the lead email in Dynamics 365 if only a name is given.',
          parameters: {
            type: 'object',
            properties: {
              customerName: {
                type: 'string',
                description: 'Prospect or lead full name (e.g. Rina Patel, John Doe)',
              },
              email: {
                type: 'string',
                description: 'Prospect email address if explicitly mentioned in the message (optional)',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'update_dynamics_lead',
          description: 'Update existing lead details in Microsoft Dynamics 365 Sales Hub (e.g. phone number, email, company, website, job title, notes).',
          parameters: {
            type: 'object',
            properties: {
              leadName: { type: 'string', description: 'Name of the lead to update' },
              phone: { type: 'string', description: 'Phone number to set or update' },
              email: { type: 'string', description: 'Email address to update' },
              company: { type: 'string', description: 'Company name to update' },
              website: { type: 'string', description: 'Website URL (e.g. yahoo.com, https://example.com)' },
              jobTitle: { type: 'string', description: 'Job title or role of the lead (e.g. Director, Manager)' },
              notes: { type: 'string', description: 'ONLY provide if user explicitly asks to update notes/description. Do NOT set this when updating phone, email, company, website, or jobTitle.' },
            },
            required: ['leadName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'schedule_appointment_in_dynamics',
          description: 'Schedule an activity/appointment in Microsoft Dynamics 365 Sales Hub regarding a specific Lead.',
          parameters: {
            type: 'object',
            properties: {
              leadName: { type: 'string', description: 'Full name of the prospect/lead' },
              subject: { type: 'string', description: 'Subject or purpose of the meeting (e.g. Product Demo)' },
              startTime: { type: 'string', description: 'ISO date time or description of meeting start' },
              durationMinutes: { type: 'number', description: 'Duration in minutes, default 30' },
              description: { type: 'string', description: 'Agenda or details for the appointment' },
            },
            required: ['leadName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'query_dynamics_appointments',
          description: 'Check, search, or list scheduled demo meetings, appointments, and calendar activities in Microsoft Dynamics 365.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search term or keyword (e.g. today, demo, client name, or topic)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'qualify_lead_to_opportunity',
          description: 'Qualify an existing lead into an active Opportunity in Microsoft Dynamics 365 Sales Hub.',
          parameters: {
            type: 'object',
            properties: {
              leadName: { type: 'string', description: 'Full name of the lead to qualify' },
            },
            required: ['leadName'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_all_leads_summary',
          description: 'Get total count of all leads, pipeline count, and recent leads list in Microsoft Dynamics 365 CRM.',
          parameters: {
            type: 'object',
            properties: {
              top: { type: 'number', description: 'Number of recent leads to retrieve (default 10)' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_dynamics_task',
          description: 'Create a new To-Do Task or follow-up activity in Microsoft Dynamics 365 regarding a Lead.',
          parameters: {
            type: 'object',
            properties: {
              leadName: { type: 'string', description: 'Full name of the lead/client' },
              subject: { type: 'string', description: 'Subject or title of the task (e.g. Send Revised Quotation)' },
              dueDate: { type: 'string', description: 'Due date and time for the task' },
              description: { type: 'string', description: 'Details or notes for the task' },
              priority: { type: 'number', description: '0 for Low, 1 for Normal, 2 for High' },
            },
            required: ['subject'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'query_dynamics_tasks',
          description: 'Check or list scheduled tasks, to-dos, and follow-ups in Microsoft Dynamics 365.',
          parameters: {
            type: 'object',
            properties: {
              leadName: { type: 'string', description: 'Optional lead name to filter tasks' },
            },
          },
        },
      },
    ];
  }

  async processMessage(sessionId, userMessage, context = {}) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        messages: [
          {
            role: 'system',
            content: `You are the internal Microsoft Dynamics 365 Sales Copilot assisting sales executives and administrators.\n${SALES_TEAM_PLAYBOOK}\nHelp the sales team log leads, look up client conversation logs, and send sales kits. Always be efficient and concise.`,
          },
        ],
        extractedLead: {},
        pendingDelete: null,   // { leadid, fullname, company, email }
        pendingConvert: null,  // { leadid, fullname, company, email }
        pendingLeadToOpen: null, // { id, name }
      });
    }

    const session = this.sessions.get(sessionId);
    if (context.currentLeadId && context.currentLeadId !== session.currentLeadId) {
      session.currentLeadId = context.currentLeadId;
      if (!context.currentLeadName) {
        const freshLead = await dynamicsService.getLeadById(context.currentLeadId);
        if (freshLead && freshLead.fullname) {
          session.currentLeadName = freshLead.fullname;
          context.currentLeadName = freshLead.fullname;
        }
      }
    }
    if (context.currentLeadName) session.currentLeadName = context.currentLeadName;
    if (context.currentLeadId) session.currentLeadId = context.currentLeadId;
    if (context.currentLeadCompany) session.currentLeadCompany = context.currentLeadCompany;
    if (context.currentLeadEmail) session.currentLeadEmail = context.currentLeadEmail;
    if (context.userTimezone) session.userTimezone = context.userTimezone;
    session.messages.push({ role: 'user', content: userMessage });

    // Check if user is responding Yes/No to open the searched lead in Dynamics 365
    if (session.pendingLeadToOpen) {
      const isYes = /\b(yes|yeah|yup|sure|ok|okay|open|proceed|ha|haa|ji)\b/i.test(userMessage.trim());
      const isNo = /\b(no|nope|cancel|stop)\b/i.test(userMessage.trim());

      if (isYes) {
        const targetLead = session.pendingLeadToOpen;
        session.pendingLeadToOpen = null;
        const confirmText = `🚀 Opening **${targetLead.name}**'s lead in Dynamics 365...`;
        session.messages.push({ role: 'assistant', content: confirmText });
        return {
          reply: confirmText,
          navigateToLead: {
            id: targetLead.id,
            name: targetLead.name,
          },
        };
      } else if (isNo) {
        session.pendingLeadToOpen = null;
        const cancelText = `Understood. Staying on your current lead form!`;
        session.messages.push({ role: 'assistant', content: cancelText });
        return { reply: cancelText };
      }
    }

    // 🗑️ Handle pending Delete Lead confirmation (Yes / No) before calling Gemini
    if (session.pendingDelete) {
      const text = userMessage.trim().toLowerCase();
      const isConfirmed = /\b(yes|yeah|yup|confirm|proceed|ok|okay|done|delete)\b/i.test(text);
      const isCancelled = /\b(no|nope|cancel|stop)\b/i.test(text);

      if (isConfirmed) {
        const { leadid, fullname } = session.pendingDelete;
        session.pendingDelete = null;
        const result = await dynamicsService.deleteLead(leadid, fullname);
        const reply = result.success
          ? `✅ **Lead Deleted Successfully!**\n\n🗑️ **${fullname}** has been permanently removed from **Microsoft Dynamics 365**.\n\n📌 This action cannot be undone. The lead record has been deleted from your CRM.`
          : `❌ **Delete Failed!**\n\nCould not delete **${fullname}** from Dynamics 365.\n\n**Error:** ${result.error || 'Unknown error'}\n\nPlease check CRM permissions or try manually from the Sales Hub.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      } else if (isCancelled) {
        const { fullname } = session.pendingDelete;
        session.pendingDelete = null;
        const reply = `🚫 **Cancelled.** Lead **${fullname}** was NOT deleted. No changes made to Dynamics 365.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      } else {
        const { fullname } = session.pendingDelete;
        const reply = `⚠️ Please confirm: Type **"yes"** to permanently delete **${fullname}**, or **"no"** to cancel.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }
    }

    // ⚡ FAST-PATH: Instant direct Dynamics 365 lookup for specific lead field queries (skips 2x Gemini roundtrips!)
    const fastLookupReply = await this.tryFastLeadLookup(session, userMessage, context);
    if (fastLookupReply) {
      session.messages.push({ role: 'assistant', content: fastLookupReply });
      return { reply: fastLookupReply, leadCreated: null };
    }



    if (this.isGemini) {
      try {
        return await this.callGemini(session, userMessage, context);
      } catch (err) {
        console.error('Gemini AI API call failed, falling back to smart engine:', err.message);
        return this.smartRuleEngine(session, userMessage, context);
      }
    } else if (this.isOpenAI) {
      try {
        return await this.callOpenAI(session, userMessage, context);
      } catch (err) {
        console.error('OpenAI API call failed, falling back to smart engine:', err.message);
        return this.smartRuleEngine(session, userMessage, context);
      }
    } else {
      return this.smartRuleEngine(session, userMessage, context);
    }
  }

  /**
   * 🎯 Strictly resolve which Lead to act on:
   * - If user says "this lead" / "him" / "her" OR did NOT explicitly type a lead name in their current message,
   *   ALWAYS use the currently open/synced Lead in Dynamics 365 (ignoring old chat history names).
   * - Only target another lead if the user explicitly typed that lead's name in userMessage.
   */
  async resolveTargetLead(userMessage, aiLeadName, session, context = {}) {
    let activeLeadId = (context && context.currentLeadId) || session.currentLeadId || null;
    let activeLeadName = (context && context.currentLeadName) || session.currentLeadName || null;

    if (activeLeadId && !activeLeadName) {
      const fresh = await dynamicsService.getLeadById(activeLeadId);
      if (fresh && fresh.fullname) {
        activeLeadName = fresh.fullname;
        session.currentLeadName = fresh.fullname;
      }
    }

    const msgLower = (userMessage || '').toLowerCase();
    const mentionsThisLead = /\b(this lead|current lead|open lead|this record|this client|him|her)\b/i.test(msgLower);

    // Check if the user actually typed a specific name or AI passed a specific lead name
    const cleanAiName = (aiLeadName || '').trim();
    const aiFirstWord = cleanAiName.split(/\s+/)[0]?.toLowerCase() || '';
    const isExplicitLeadName =
      cleanAiName.length >= 2 &&
      aiFirstWord.length >= 2 &&
      !['this', 'current', 'active', 'lead', 'open', 'him', 'her', 'this lead'].includes(cleanAiName.toLowerCase()) &&
      !['this', 'current', 'active', 'lead', 'open', 'him', 'her'].includes(aiFirstWord);

    const userExplicitlyTypedAiName =
      isExplicitLeadName &&
      (msgLower.includes(aiFirstWord) || msgLower.includes(cleanAiName.toLowerCase()));

    // If user explicitly said "this lead" / "current lead" OR didn't mention any person's name at all, use active lead
    if ((mentionsThisLead || (!userExplicitlyTypedAiName && !isExplicitLeadName)) && activeLeadId) {
      return {
        leadId: activeLeadId,
        leadName: activeLeadName || 'Active Lead',
      };
    }

    // Otherwise, search Dynamics 365 for the explicitly named lead
    const lookupName = (userExplicitlyTypedAiName || isExplicitLeadName) ? cleanAiName : (activeLeadName || cleanAiName);
    if (lookupName) {
      const searchResult = await dynamicsService.findLeadForDelete(lookupName);
      if (searchResult.found && searchResult.leads && searchResult.leads.length > 0) {
        return {
          leadId: searchResult.leads[0].leadid,
          leadName: searchResult.leads[0].fullname,
        };
      }
      // CRITICAL FIX: If an explicit lead name was requested (e.g. "Abhi Viramgama")
      // and it was NOT found in CRM, NEVER fallback to activeLeadId (e.g. Nidhip Desai)!
      if (userExplicitlyTypedAiName || isExplicitLeadName) {
        return {
          leadId: null,
          leadName: cleanAiName,
          notFound: true,
        };
      }
    }

    return {
      leadId: activeLeadId,
      leadName: activeLeadName || cleanAiName || null,
    };
  }

  /**
   * ⚡ Fast Direct Lead Field Lookup — answers company, phone, email, website, jobTitle, or lead details
   * in ~0.5-1s with a single Dynamics 365 API call (0 LLM latency).
   */
  async tryFastLeadLookup(session, userMessage, context = {}) {
    const text = (userMessage || '').trim();
    const lower = text.toLowerCase();

    // Do not intercept write/action/summary/history intents
    if (
      /\b(update|upade|change|set|add|create|new|log|save|delete|remove|erase|schedule|book|appointment|meeting|demo|task|todo|follow-up|followup|qualify|convert|opportunity|brochure|pdf|catalog|send|mail|total|all leads|pipeline|recent lead|latest lead|last lead|history|conversation|last talk|notes|discussed|vat|requirement)\b/i.test(lower)
    ) {
      return null;
    }

    const asksCompany = /\b(company|company name|organization|firm)\b/i.test(lower);
    const asksPhone = /\b(phone|mobile|contact number|phone number|mobile number|number|call number)\b/i.test(lower);
    const asksEmail = /\b(email|email address|mail id|e-mail)\b/i.test(lower);
    const asksWebsite = /\b(website|web site|site|url|domain)\b/i.test(lower);
    const asksJobTitle = /\b(job title|designation|role|position)\b/i.test(lower);
    const asksDetails = /\b(find lead|search lead|\bsearch\b|\bfind\b|details of|detail of|info on|information about|who is|tell me about|show me lead|lookup|look up)\b/i.test(lower);

    if (!asksCompany && !asksPhone && !asksEmail && !asksWebsite && !asksJobTitle && !asksDetails) {
      return null;
    }

    let targetName = '';
    if (/\b(this lead|his|her)\b/i.test(lower)) {
      targetName = context.currentLeadName || session.currentLeadName || '';
    }

    if (!targetName) {
      const STOPWORDS_FAST = /\b(what|is|are|was|give|me|tell|show|find|search|lookup|look|up|get|check|lead|record|for|of|about|on|in|from|the|a|an|company|organization|firm|name|contact|phone|mobile|telephone|number|email|e-mail|mail|id|address|website|web|site|url|domain|job|title|designation|role|position|details|detail|info|information|who|dynamics|crm|please|can|you|could|his|her|current)\b/gi;
      const cleaned = text
        .replace(/'s|’s/gi, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(STOPWORDS_FAST, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 2) {
        targetName = cleaned;
      }
    }

    if (!targetName || targetName.length < 2) {
      return null;
    }

    try {
      const searchResult = await dynamicsService.searchLead(targetName, { includeTimelineNotes: false });
      if (!searchResult || !searchResult.found) {
        return `ℹ️ No lead records found in Dynamics 365 matching "${targetName}".`;
      }

      if (searchResult.leadId) {
        session.pendingLeadToOpen = {
          id: searchResult.leadId,
          name: searchResult.name,
        };
      }

      const openPrompt = `Would you like me to open ${searchResult.name}'s lead in Dynamics 365? (Reply Yes or No)`;

      if (asksCompany && !asksDetails) {
        return searchResult.company && searchResult.company !== 'N/A'
          ? `${searchResult.name}'s company name is **${searchResult.company}**.\n\n${openPrompt}`
          : `I'm sorry, but ${searchResult.name}'s company name is currently not on file in the CRM.\n\n${openPrompt}`;
      }

      if (asksPhone && !asksDetails) {
        if (searchResult.phone && searchResult.phone !== 'N/A') {
          return `${searchResult.name}'s contact number is **${searchResult.phone}**.\n\n${openPrompt}`;
        }
        const fallbackEmail = searchResult.email && searchResult.email !== 'N/A'
          ? `, though I do have their email address at **${searchResult.email}**`
          : '';
        return `I'm sorry, but ${searchResult.name}'s phone number is currently not on file in the CRM${fallbackEmail}.\n\n${openPrompt}`;
      }

      if (asksEmail && !asksDetails) {
        if (searchResult.email && searchResult.email !== 'N/A') {
          return `${searchResult.name}'s email address is **${searchResult.email}**.\n\n${openPrompt}`;
        }
        const fallbackPhone = searchResult.phone && searchResult.phone !== 'N/A'
          ? `, though I do have their contact number (**${searchResult.phone}**)`
          : '';
        return `I'm sorry, but ${searchResult.name}'s email address is currently not on file in the CRM${fallbackPhone}.\n\n${openPrompt}`;
      }

      if (asksWebsite && !asksDetails) {
        return searchResult.website && searchResult.website !== 'N/A'
          ? `${searchResult.name}'s website is **${searchResult.website}**.\n\n${openPrompt}`
          : `I'm sorry, but ${searchResult.name}'s website is currently not on file in the CRM.\n\n${openPrompt}`;
      }

      if (asksJobTitle && !asksDetails) {
        return searchResult.jobTitle && searchResult.jobTitle !== 'N/A'
          ? `${searchResult.name}'s job title is **${searchResult.jobTitle}**.\n\n${openPrompt}`
          : `I'm sorry, but ${searchResult.name}'s job title is currently not on file in the CRM.\n\n${openPrompt}`;
      }

      return `🔍 **Dynamics 365 Lead Details for ${searchResult.name}:**\n` +
        `- **Name:** ${searchResult.name || 'N/A'}\n` +
        `- **Company:** ${searchResult.company || 'N/A'}\n` +
        `- **Phone:** ${searchResult.phone || 'N/A (Not on file)'}\n` +
        `- **Email:** ${searchResult.email || 'N/A'}\n` +
        (searchResult.website ? `- **Website:** ${searchResult.website}\n` : '') +
        (searchResult.jobTitle ? `- **Job Title:** ${searchResult.jobTitle}\n` : '') +
        `\n${openPrompt}`;
    } catch (err) {
      console.error('Fast lead lookup error:', err.message);
      return null;
    }
  }

  async callOpenAI(session, userMessage, context = {}) {
    let leadCreated = null;
    const activeLead = context.currentLeadName || session.currentLeadName;
    if (activeLead && session.messages.length > 0 && session.messages[0].role === 'system') {
      session.messages[0].content = `You are the internal Microsoft Dynamics 365 Sales Copilot assisting sales executives and administrators.\n${SALES_TEAM_PLAYBOOK}\n[Active Dynamics 365 Lead Context]: The sales user is currently on the Dynamics 365 form for "${activeLead}".
- Unless the user explicitly names a different person in their latest message, ALWAYS assume any actions (such as scheduling a meeting, creating a task, or qualifying) apply directly to "${activeLead}".
- NEVER reuse older lead names from prior messages unless explicitly requested.\nHelp the sales team log leads, look up client conversation logs, and send sales kits. Always be efficient and concise.`;
    }

    let response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: session.messages,
      tools: this.getTools(),
      tool_choice: 'auto',
    });

    let choice = response.choices[0];

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.function.name === 'save_lead_to_dynamics') {
          const leadArgs = JSON.parse(toolCall.function.arguments);
          leadCreated = await dynamicsService.createLead(leadArgs);

          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              status: 'success',
              message: 'Lead record has been successfully created in Microsoft Dynamics 365.',
              leadId: leadCreated.id,
            }),
          });
        } else if (toolCall.function.name === 'query_dynamics_lead_history') {
          const args = JSON.parse(toolCall.function.arguments);
          const searchResult = await dynamicsService.searchLead(args.query);

          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              ...searchResult,
              _strictRule: 'IMPORTANT: Always use the primary CRM fields (company, email, phone, website, jobTitle, subject) as the ONLY source of truth when answering questions about company name, website, email, phone, or job title. NEVER let text inside description or timelineNotes override a primary CRM field. Only use description and timelineNotes when the user asks about past conversation history, last discussion, notes, or requirements.',
            }),
          });
        } else if (toolCall.function.name === 'send_product_brochure_email') {
          const args = JSON.parse(toolCall.function.arguments);
          let targetEmail = args.email;
          let targetName = args.customerName;

          const emailMatchInMsg = (userMessage || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          const userTypedEmail = emailMatchInMsg ? emailMatchInMsg[0] : null;

          if (userTypedEmail) {
            targetEmail = userTypedEmail;
          } else if (targetEmail && (targetEmail.includes('example.com') || !(userMessage || '').includes(targetEmail))) {
            targetEmail = null;
          }

          if (!targetEmail) {
            // 1. If targetName or a specific lead name is specified, look up THAT lead first!
            const isGeneric = !targetName || /^(this lead|him|her|this client|this record|the lead)$/i.test(targetName.trim());
            if (!isGeneric && targetName) {
              const searchRes = await dynamicsService.searchLead(targetName);
              if (searchRes && searchRes.found && searchRes.email && searchRes.email.includes('@')) {
                targetEmail = searchRes.email;
                targetName = searchRes.name || targetName;
              }
            }

            // 2. Fall back to active lead context ONLY if no specific lead name was found
            if (!targetEmail) {
              const activeId = context.currentLeadId || session.currentLeadId;
              if (activeId) {
                try {
                  const activeLead = await dynamicsService.getLeadById(activeId);
                  if (activeLead && activeLead.email && activeLead.email.includes('@')) {
                    targetEmail = activeLead.email;
                    targetName = activeLead.fullname || targetName;
                  }
                } catch (e) {
                  console.error('Error fetching active lead by ID for brochure:', e.message);
                }
              }
            }
          }

          let emailResult;
          if (targetEmail && targetEmail.includes('@')) {
            emailResult = await emailService.sendBrochure(targetEmail, targetName || 'Valued Customer');
          } else {
            emailResult = { success: false, error: `Could not find an email address for ${targetName || 'this contact'} in Dynamics 365.` };
          }

          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(emailResult),
          });
        } else if (toolCall.function.name === 'update_dynamics_lead') {
          const args = JSON.parse(toolCall.function.arguments);
          const searchResult = await dynamicsService.findLeadForDelete(args.leadName);
          let updateRes;
          if (searchResult.found && searchResult.leads && searchResult.leads.length > 0) {
            const lead = searchResult.leads[0];
            updateRes = await dynamicsService.updateLead(lead.leadid, lead.fullname, args);
          } else {
            updateRes = { success: false, error: `No lead found matching "${args.leadName}"` };
          }

          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(updateRes),
          });
        } else if (toolCall.function.name === 'schedule_appointment_in_dynamics') {
          const args = JSON.parse(toolCall.function.arguments);
          let leadId = null;
          let leadName = args.leadName;
          const searchResult = await dynamicsService.findLeadForDelete(args.leadName);
          if (searchResult.found && searchResult.leads && searchResult.leads.length > 0) {
            leadId = searchResult.leads[0].leadid;
            leadName = searchResult.leads[0].fullname;
          }
          const apptRes = await dynamicsService.createAppointment({
            leadId,
            leadName,
            subject: args.subject,
            startTime: args.startTime,
            durationMinutes: args.durationMinutes || 30,
            description: args.description,
          });

          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(apptRes),
          });
        } else if (toolCall.function.name === 'qualify_lead_to_opportunity') {
          const args = JSON.parse(toolCall.function.arguments);
          let targetLeadName = args.leadName || session.currentLeadName;
          let targetLeadId = session.currentLeadId;
          const searchResult = await dynamicsService.findLeadForDelete(targetLeadName);
          if (searchResult.found && searchResult.leads && searchResult.leads.length > 0) {
            targetLeadId = searchResult.leads[0].leadid;
            targetLeadName = searchResult.leads[0].fullname;
          }
          const qualifyRes = await dynamicsService.qualifyLead(targetLeadId, targetLeadName);
          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(qualifyRes),
          });
        } else if (toolCall.function.name === 'get_all_leads_summary') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const leadsData = await dynamicsService.getAllLeads(args.top || 15);
          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(leadsData),
          });
        } else if (toolCall.function.name === 'create_dynamics_task') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          let targetLeadName = args.leadName || session.currentLeadName;
          let targetLeadId = session.currentLeadId;
          if (!targetLeadId && targetLeadName) {
            const searchResult = await dynamicsService.findLeadForDelete(targetLeadName);
            if (searchResult.found && searchResult.leads && searchResult.leads.length > 0) {
              targetLeadId = searchResult.leads[0].leadid;
              targetLeadName = searchResult.leads[0].fullname;
            }
          }
          const taskRes = await dynamicsService.createTask({
            leadId: targetLeadId,
            leadName: targetLeadName,
            subject: args.subject,
            dueDate: args.dueDate,
            description: args.description,
            priority: args.priority || 1,
          });
          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(taskRes),
          });
        } else if (toolCall.function.name === 'query_dynamics_tasks') {
          const taskRes = await dynamicsService.getTasks({
            top: 15,
          });
          session.messages.push(choice.message);
          session.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(taskRes),
          });
        }
      }

      const secondResponse = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: session.messages,
      });

      const replyText = secondResponse.choices[0].message.content;
      session.messages.push({ role: 'assistant', content: replyText });
      return { reply: replyText, leadCreated };
    }

    const replyText = choice.message.content;
    session.messages.push({ role: 'assistant', content: replyText });
    return { reply: replyText, leadCreated: null };
  }

  getGeminiTools() {
    return [
      {
        functionDeclarations: [
          {
            name: 'save_lead_to_dynamics',
            description: 'Record a new customer lead or phone inquiry directly into Microsoft Dynamics 365 Sales Hub.',
            parameters: {
              type: 'OBJECT',
              properties: {
                fullname: { type: 'STRING', description: 'Full name of the client/prospect' },
                email: { type: 'STRING', description: 'Email address of the client' },
                phone: { type: 'STRING', description: 'Contact phone number of the client' },
                company: { type: 'STRING', description: 'Company name or organization' },
                requirement: { type: 'STRING', description: 'Call notes, package interest, or inquiry description' },
              },
              required: ['fullname', 'email'],
            },
          },
          {
            name: 'query_dynamics_lead_history',
            description: 'Search Microsoft Dynamics 365 CRM to fetch past conversation logs, timeline notes, or contact info about a client or company.',
            parameters: {
              type: 'OBJECT',
              properties: {
                query: { type: 'STRING', description: 'Company name, client name, or email to search in Dynamics 365' },
              },
              required: ['query'],
            },
          },
          {
            name: 'send_product_brochure_email',
            description: 'Dispatch the official Product Brochure PDF and Pricing Guide to a prospect or lead. Accepts customerName (e.g. "Rina Patel"). Only provide email if the user explicitly typed an email in their message. NEVER fabricate or hallucinate dummy emails (like @example.com).',
            parameters: {
              type: 'OBJECT',
              properties: {
                customerName: { type: 'STRING', description: 'Prospect or lead full name (e.g. Rina Patel)' },
                email: { type: 'STRING', description: 'Prospect email ONLY if explicitly typed by the user in the prompt' },
              },
              required: ['customerName'],
            },
          },
          {
            name: 'update_dynamics_lead',
            description: 'Update existing lead details in Microsoft Dynamics 365 Sales Hub (e.g. phone number, email, company, website, job title, notes).',
            parameters: {
              type: 'OBJECT',
              properties: {
                leadName: { type: 'STRING', description: 'Name of the lead to update' },
                phone: { type: 'STRING', description: 'Phone number to set or update' },
                email: { type: 'STRING', description: 'Email address to update' },
                company: { type: 'STRING', description: 'Company name to update' },
                website: { type: 'STRING', description: 'Website URL (e.g. yahoo.com, https://example.com)' },
                jobTitle: { type: 'STRING', description: 'Job title or role of the lead (e.g. Director, Manager)' },
                notes: { type: 'STRING', description: 'ONLY provide if user explicitly asks to update notes/description. Do NOT set this when updating phone, email, company, website, or jobTitle.' },
              },
              required: ['leadName'],
            },
          },
          {
            name: 'schedule_appointment_in_dynamics',
            description: 'Schedule an activity/appointment in Microsoft Dynamics 365 Sales Hub regarding a specific Lead.',
            parameters: {
              type: 'OBJECT',
              properties: {
                leadName: { type: 'STRING', description: 'Full name of the prospect/lead' },
                subject: { type: 'STRING', description: 'Subject or purpose of the meeting (e.g. Product Demo)' },
                startTime: { type: 'STRING', description: 'ISO date time or description of meeting start' },
                durationMinutes: { type: 'NUMBER', description: 'Duration in minutes, default 30' },
                description: { type: 'STRING', description: 'Agenda or details for the appointment' },
              },
              required: ['leadName'],
            },
          },
          {
            name: 'query_dynamics_appointments',
            description: 'Check, search, or list scheduled demo meetings, appointments, and calendar activities in Microsoft Dynamics 365.',
            parameters: {
              type: 'OBJECT',
              properties: {
                query: { type: 'STRING', description: 'Search term or keyword (e.g. today, demo, client name, or topic)' },
              },
            },
          },
          {
            name: 'qualify_lead_to_opportunity',
            description: 'Qualify an existing lead in Microsoft Dynamics 365 Sales Hub, converting it into an active Opportunity.',
            parameters: {
              type: 'OBJECT',
              properties: {
                leadName: { type: 'STRING', description: 'Full name of the lead to qualify' },
              },
              required: ['leadName'],
            },
          },
          {
            name: 'get_all_leads_summary',
            description: 'Get total count of all leads, pipeline count, and recent leads list in Microsoft Dynamics 365 CRM.',
            parameters: {
              type: 'OBJECT',
              properties: {
                top: { type: 'NUMBER', description: 'Number of recent leads to retrieve (default 10)' },
              },
            },
          },
          {
            name: 'create_dynamics_task',
            description: 'Create a new To-Do Task or follow-up activity in Microsoft Dynamics 365 regarding a Lead.',
            parameters: {
              type: 'OBJECT',
              properties: {
                leadName: { type: 'STRING', description: 'Full name of the lead/client' },
                subject: { type: 'STRING', description: 'Subject or title of the task (e.g. Send Revised Quotation)' },
                dueDate: { type: 'STRING', description: 'Due date and time for the task' },
                description: { type: 'STRING', description: 'Details or notes for the task' },
                priority: { type: 'NUMBER', description: '0 for Low, 1 for Normal, 2 for High' },
              },
              required: ['subject'],
            },
          },
          {
            name: 'query_dynamics_tasks',
            description: 'Check or list scheduled tasks, to-dos, and follow-ups in Microsoft Dynamics 365.',
            parameters: {
              type: 'OBJECT',
              properties: {
                leadName: { type: 'STRING', description: 'Optional lead name to filter tasks' },
              },
            },
          },
          {
            name: 'delete_dynamics_lead',
            description: 'Delete or remove a lead record from Microsoft Dynamics 365 CRM (e.g. "Delete this lead from Dynamics", "Delete Rina Patel lead").',
            parameters: {
              type: 'OBJECT',
              properties: {
                leadName: { type: 'STRING', description: 'Full name of the lead to delete (or "this lead" if deleting the currently open lead)' },
              },
            },
          },
        ],
      },
    ];
  }

  async callGemini(session, userMessage, context = {}) {
    let leadCreated = null;
    let systemInstruction = `You are the internal Microsoft Dynamics 365 Sales Copilot assisting sales executives and administrators.\n${SALES_TEAM_PLAYBOOK}\nHelp the sales team log leads, look up client conversation logs, and send sales kits. Always be efficient, concise, and helpful.`;
    const activeLead = context.currentLeadName || session.currentLeadName;
    if (activeLead) {
      systemInstruction += `\n\n[Current Dynamics 365 Lead Context]: "${activeLead}".
- The sales user is currently working on the open Dynamics 365 form for "${activeLead}".
- Unless the user explicitly mentions a different person by name in their latest message, ALWAYS assume that all contextual sales actions (such as generating a proposal, scheduling a meeting, creating a task, deleting, checking notes, or qualifying) apply directly to "${activeLead}".
- NEVER use older lead names from past chat messages when the user did not type that name in their latest message.
- For global questions across all leads (such as "all leads", "anyone", "any meetings today", "pipeline summary"), query Dynamics 365 across all records.`;
    }

    const history = [];
    for (const msg of session.messages.slice(1, -1)) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        history.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
        history.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }

    // 🚀 Multi-Tier Model Fallback:
    const primaryModel = this.modelName || 'gemini-3.1-flash-lite';
    const fallbackCandidates = [primaryModel, 'gemini-3.1-flash-lite-preview', 'gemini-3.8-flash']
      .filter((val, idx, arr) => arr.indexOf(val) === idx);

    let result = null;
    let successfulModel = primaryModel;
    let lastError = null;

    for (const candidateModel of fallbackCandidates) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: candidateModel,
          systemInstruction,
          tools: this.getGeminiTools(),
        });
        const chat = model.startChat({ history });
        result = await chat.sendMessage(userMessage);
        successfulModel = candidateModel;
        break; // Successfully got response from Gemini
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
      let replyText = '';

      if (call.name === 'save_lead_to_dynamics') {
        const leadArgs = call.args;
        leadCreated = await dynamicsService.createLead(leadArgs);
        replyText = `✅ **Lead Created in Microsoft Dynamics 365!**\n- **Name:** ${leadArgs.fullname || 'Lead'}\n- **Email:** ${leadArgs.email || 'N/A'}\n- **Phone:** ${leadArgs.phone || 'N/A'}\n- **Company:** ${leadArgs.company || 'N/A'}\n- **Record ID:** \`${leadCreated.id || leadCreated._guid || 'Synced'}\`\n\nThe lead is now live in Dynamics 365 Sales Hub!`;
      } else if (call.name === 'query_dynamics_lead_history') {
        const isActuallyBrochureRequest = /\b(send|email|mail|dispatch)\b/i.test(userMessage) && /\b(brochure|catalog|pdf|pricing)\b/i.test(userMessage);
        if (isActuallyBrochureRequest) {
          const searchResult = await dynamicsService.searchLead(call.args.query);
          if (searchResult && searchResult.found && searchResult.email && searchResult.email.includes('@')) {
            const emailResult = await emailService.sendBrochure(searchResult.email, searchResult.name || 'Valued Customer');
            replyText = emailResult.success
              ? `Done! 🚀 I have dispatched the official **Product Brochure & Pricing Guide (PDF)** to **${searchResult.email}** (${searchResult.name || 'Client'}) on your behalf.\n\n📄 **Attachment:** \`${emailResult.brochure}\`\n📧 **Status:** ${emailResult.status}`
              : `⚠️ Failed to send brochure: ${emailResult.error}`;
            session.messages.push({ role: 'assistant', content: replyText });
            return { reply: replyText, leadCreated: null };
          } else {
            replyText = `❌ No lead found in **Dynamics 365** matching **"${call.args.query}"** to send the brochure.\n\nPlease check the name or provide their email address directly.`;
            session.messages.push({ role: 'assistant', content: replyText });
            return { reply: replyText, leadCreated: null };
          }
        }

        const needsHistory = /\b(history|conversation|notes|last|talk|discussed|vat|requirement|summary)\b/i.test(userMessage || '');
        const searchResult = await dynamicsService.searchLead(call.args.query, { includeTimelineNotes: needsHistory });
        if (searchResult && searchResult.found) {
          if (searchResult.leadId) {
            session.pendingLeadToOpen = {
              id: searchResult.leadId,
              name: searchResult.name,
            };
          }
          if (needsHistory) {
            const followPrompt = `User question: "${userMessage}"
Retrieved Dynamics 365 CRM data for lead:

[1. OFFICIAL MAIN CRM LEAD FIELDS — STRICT SOURCE OF TRUTH]:
- Name: ${searchResult.name || 'N/A'}
- Company Name: ${searchResult.company || 'N/A'}
- Phone / Mobile: ${searchResult.phone || 'N/A (Not on file)'}
- Email: ${searchResult.email || 'N/A'}

[2. CONVERSATION HISTORY & NOTES (Description / Timeline Notes)]:
- Lead Description / Requirement Notes: ${searchResult.description ? searchResult.description.replace(/\n+/g, ' ') : 'N/A'}
- Timeline / Recent Conversation History: ${searchResult.timelineNotes ? searchResult.timelineNotes.replace(/\n+/g, ' ') : 'N/A'}

STRICT INSTRUCTIONS:
Summarize the conversation history and notes for this lead directly and concisely in 1-2 natural sentences.
ALWAYS conclude on a new line with:
"Would you like me to open ${searchResult.name}'s lead in Dynamics 365? (Reply Yes or No)"`;
            try {
              const followRes = await this.genAI.getGenerativeModel({ model: this.modelName || 'gemini-3.1-flash-lite' }).generateContent(followPrompt);
              replyText = followRes.response.text();
            } catch (e) {
              replyText = `🔍 **Dynamics 365 Lead Details for ${searchResult.name}:**\n- **Company:** ${searchResult.company || 'N/A'}\n- **Email:** ${searchResult.email || 'N/A'}\n- **Phone:** ${searchResult.phone || 'N/A'}\n\nWould you like me to open ${searchResult.name}'s lead in Dynamics 365? (Reply Yes or No)`;
            }
          } else {
            // ⚡ Instant direct response — cuts latency in half!
            replyText = `🔍 **Dynamics 365 Lead Details for ${searchResult.name}:**\n` +
              `- **Company:** ${searchResult.company || 'N/A'}\n` +
              `- **Email:** ${searchResult.email || 'N/A'}\n` +
              `- **Phone:** ${searchResult.phone || 'N/A (Not on file)'}\n` +
              (searchResult.jobTitle && searchResult.jobTitle !== 'N/A' ? `- **Job Title:** ${searchResult.jobTitle}\n` : '') +
              (searchResult.website && searchResult.website !== 'N/A' ? `- **Website:** ${searchResult.website}\n` : '') +
              `\nWould you like me to open ${searchResult.name}'s lead in Dynamics 365? (Reply Yes or No)`;
          }
        } else {
          replyText = `ℹ️ No lead records found in Dynamics 365 matching "${call.args.query}".`;
        }
      } else if (call.name === 'send_product_brochure_email') {
        let targetEmail = call.args && call.args.email;
        let targetName = call.args && call.args.customerName;

        // Check if user explicitly typed a person's name in their message
        const msgLower = (userMessage || '').toLowerCase();
        const aiName = (targetName || '').trim();
        const aiFirstWord = aiName.split(/\s+/)[0]?.toLowerCase() || '';
        const userTypedPersonName = aiName && aiName.length >= 2 && aiFirstWord.length >= 2 &&
          !['this', 'current', 'active', 'open', 'lead', 'client', 'brochure', 'catalog'].includes(aiFirstWord) &&
          (msgLower.includes(aiFirstWord) || msgLower.includes(aiName.toLowerCase()));

        if (!userTypedPersonName) {
          // If user did NOT type a specific name, use currently active lead instead of old chat history names!
          targetName = context.currentLeadName || session.currentLeadName || null;
        }

        // Check if user explicitly typed an email in the chat message
        const emailMatchInMsg = (userMessage || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const userTypedEmail = emailMatchInMsg ? emailMatchInMsg[0] : null;

        // If user explicitly typed an email, use it. Otherwise, discard any hallucinated email (like rinapatel@example.com) and fetch real email from Dynamics 365!
        if (userTypedEmail) {
          targetEmail = userTypedEmail;
        } else if (targetEmail && (targetEmail.includes('example.com') || targetEmail.includes('@test.com') || !(userMessage || '').includes(targetEmail))) {
          targetEmail = null;
        }

        // Lookup REAL email in Dynamics 365
        if (!targetEmail) {
          // 1. If a specific customerName or lead name was specified, ALWAYS look up that person first!
          let lookupName = targetName;
          if (!lookupName || lookupName.length < 2) {
            const cleaned = userMessage.replace(/\b(send|email|mail|dispatch|brochure|catalog|pdf|pricing|guide|to|for|please|can|you)\b/gi, '').trim();
            if (cleaned.length > 1) lookupName = cleaned;
          }

          const isGeneric = !lookupName || /^(this lead|him|her|this client|this record|the lead|this)$/i.test(lookupName.trim());

          if (!isGeneric && lookupName) {
            const searchRes = await dynamicsService.searchLead(lookupName);
            if (searchRes && searchRes.found) {
              if (searchRes.email && searchRes.email.includes('@')) {
                targetEmail = searchRes.email;
                targetName = searchRes.name || targetName;
              } else {
                replyText = `⚠️ Lead **"${searchRes.name || lookupName}"** was found in Dynamics 365, but has no email address on file to send the brochure.`;
                session.messages.push({ role: 'assistant', content: replyText });
                return { reply: replyText, leadCreated: null };
              }
            } else {
              // ❌ Explicit lead name was NOT found in Dynamics 365! NEVER fall back to active lead!
              replyText = `❌ No lead found in **Dynamics 365** matching **"${lookupName}"** to send the brochure.\n\nPlease check the name or provide their email address directly.`;
              session.messages.push({ role: 'assistant', content: replyText });
              return { reply: replyText, leadCreated: null };
            }
          }

          // 2. Fall back to active lead context ONLY if NO specific name was given (e.g. generic "send brochure", "to this lead")
          if (!targetEmail && isGeneric) {
            const activeId = context.currentLeadId || session.currentLeadId;
            if (activeId) {
              try {
                const activeLead = await dynamicsService.getLeadById(activeId);
                if (activeLead && activeLead.email && activeLead.email.includes('@')) {
                  targetEmail = activeLead.email;
                  targetName = activeLead.fullname || targetName;
                }
              } catch (e) {
                console.error('Error fetching active lead by ID for brochure:', e.message);
              }
            }
          }
        }

        if (targetEmail && targetEmail.includes('@')) {
          const emailResult = await emailService.sendBrochure(targetEmail, targetName || 'Valued Customer');
          replyText = emailResult.success
            ? `Done! 🚀 I have dispatched the official **Product Brochure & Pricing Guide (PDF)** to **${targetEmail}** (${targetName || 'Client'}) on your behalf.\n\n📄 **Attachment:** \`${emailResult.brochure}\`\n📧 **Status:** ${emailResult.status}`
            : `⚠️ Failed to send brochure: ${emailResult.error}`;
        } else {
          replyText = `⚠️ Could not find an email address for **${targetName || 'this contact'}** in Dynamics 365 to send the brochure. Please specify an email address.`;
        }
      } else if (call.name === 'update_dynamics_lead') {
        const resolved = await this.resolveTargetLead(userMessage, call.args && call.args.leadName, session, context);
        const targetLeadId = resolved.leadId;
        const targetLeadName = resolved.leadName;
        if (targetLeadId) {
          const updateRes = await dynamicsService.updateLead(targetLeadId, targetLeadName, call.args);
          replyText = updateRes.success
            ? `✅ Successfully updated lead **${targetLeadName}** in Dynamics 365!\n\n*(Please click **Refresh** on the Dynamics 365 lead ribbon to display the new field value).*`
            : `⚠️ Could not update lead: ${updateRes.error}`;
        } else {
          replyText = `⚠️ No lead found matching "${call.args?.leadName || targetLeadName}" to update.`;
        }
      } else if (call.name === 'schedule_appointment_in_dynamics') {
        const resolved = await this.resolveTargetLead(userMessage, call.args && call.args.leadName, session, context);
        const leadId = resolved.leadId;
        const leadName = resolved.leadName || call.args.leadName;
        const apptRes = await dynamicsService.scheduleAppointment({
          leadId,
          leadName,
          subject: call.args.subject,
          startTime: call.args.startTime,
          durationMinutes: call.args.durationMinutes || 30,
          description: call.args.description,
        });
        const userTz = session.userTimezone || 'Asia/Kolkata';
        const formattedDate = apptRes.startTime ? new Date(apptRes.startTime).toLocaleString('en-US', { timeZone: userTz, dateStyle: 'medium', timeStyle: 'short' }) : 'Next Business Day';
        replyText = apptRes.success
          ? `📅 **Appointment Scheduled in Dynamics 365!**\n- **Subject:** ${call.args.subject}\n- **Lead:** ${leadName}\n- **Date & Time:** ${formattedDate} (${userTz})\n- **Duration:** ${call.args.durationMinutes || 30} mins`
          : `⚠️ Failed to schedule appointment: ${apptRes.error}`;
      } else if (call.name === 'query_dynamics_appointments') {
        const userMsgLower = (userMessage || '').toLowerCase();
        let targetLeadId = null;
        // Only restrict to a specific lead if user explicitly asks for "this lead", "him", "her", or "this record"
        if (/\b(this lead|with him|with her|with this client|this record)\b/i.test(userMsgLower) && session.currentLeadId) {
          targetLeadId = session.currentLeadId;
        }

        const apptRes = await dynamicsService.getAppointments({
          leadId: targetLeadId,
          top: 30,
        });
        if (apptRes && apptRes.found && apptRes.appointments.length > 0) {
          const userTz = session.userTimezone || 'Asia/Kolkata';
          const list = apptRes.appointments.map(a => {
            const startLocal = new Date(a.start).toLocaleString('en-US', {
              timeZone: userTz,
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const endLocal = new Date(a.end).toLocaleString('en-US', {
              timeZone: userTz,
              hour: '2-digit',
              minute: '2-digit',
            });
            return `- Subject: ${a.subject}\n  Start Time: ${startLocal}\n  End Time: ${endLocal}\n  Status: ${a.status}\n  Details: ${a.description || 'N/A'}`;
          }).join('\n\n');

          const nowInUserTz = new Date().toLocaleString('en-US', {
            timeZone: userTz,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });

          const followPrompt = `User question: "${userMessage}"
User Local Timezone: ${userTz}
Current Date & Time in User Timezone: ${nowInUserTz}
Retrieved scheduled appointments across Microsoft Dynamics 365 (already converted to User Local Timezone ${userTz}):
${list}

CRITICAL RULES:
1. Answer the user question directly and accurately based ONLY on the retrieved appointments list.
2. If the user asked if there are any demo meetings "today", check if any appointment's Start Time matches today's date (${nowInUserTz}).
   - If an appointment date matches today, report it immediately! Explicitly specify the Subject, Client/Lead name (from subject or details), and Start Time.
   - Do NOT say "no demo meetings scheduled for today" if there is an appointment with today's date!
3. If no meetings are scheduled for today, clearly say no meetings are scheduled for today, and mention the next upcoming meeting date/time.
4. Keep the answer natural, concise, and professional (1-3 sentences).`;

          try {
            const followRes = await this.genAI.getGenerativeModel({ model: this.modelName || 'gemini-3.1-flash-lite' }).generateContent(followPrompt);
            replyText = followRes.response.text();
          } catch (e) {
            replyText = `📅 **Scheduled Appointments in Dynamics 365:**\n` + apptRes.appointments.map(a => `• **${a.subject}** (${new Date(a.start).toLocaleString('en-US', { timeZone: userTz })}) - Status: ${a.status}`).join('\n');
          }
        } else {
          replyText = `📅 There are currently no scheduled demo meetings or appointments found in Dynamics 365 for your query.`;
        }
      } else if (call.name === 'qualify_lead_to_opportunity') {
        const resolved = await this.resolveTargetLead(userMessage, call.args && call.args.leadName, session, context);
        const targetLeadId = resolved.leadId;
        const targetLeadName = resolved.leadName;

        if (targetLeadId) {
          const qualifyRes = await dynamicsService.qualifyLead(targetLeadId, targetLeadName);
          if (qualifyRes.success) {
            if (qualifyRes.alreadyQualified) {
              replyText = `ℹ️ **${targetLeadName}** is **already Qualified** in Microsoft Dynamics 365!\n\n(This lead has already been converted to an active Opportunity. Please refresh your Dynamics 365 browser tab to see the updated status).`;
            } else {
              replyText = `🏆 **Lead Successfully Qualified in Dynamics 365!**\n\n- **Lead:** ${targetLeadName}\n- **Status:** Qualified\n- **Pipeline:** Opportunity Created\n\nThe lead record has been officially qualified and converted to an active Opportunity in Microsoft Dynamics 365 Sales Hub!`;
            }
          } else {
            replyText = `⚠️ Failed to qualify lead **${targetLeadName}**: ${qualifyRes.error || 'CRM error'}`;
          }
        } else {
          replyText = `⚠️ Could not find a lead matching "${targetLeadName}" in Dynamics 365 to qualify.`;
        }
      } else if (call.name === 'get_all_leads_summary') {
        const leadsData = await dynamicsService.getAllLeads((call.args && call.args.top) || 15);
        const total = leadsData.totalCount || (leadsData.leads ? leadsData.leads.length : 0);
        const qualifiedCount = leadsData.qualifiedCount !== undefined ? leadsData.qualifiedCount : (leadsData.leads ? leadsData.leads.filter(l => l.status === 'Qualified').length : 0);
        const openCount = leadsData.openCount !== undefined ? leadsData.openCount : (leadsData.leads ? leadsData.leads.filter(l => l.status === 'New / Open').length : 0);

        const isAskingSpecificallyQualified = /\b(qualif|converted)\b/i.test(userMessage);
        const isAskingSpecificallyOpen = /\b(open|new|unqualified)\b/i.test(userMessage);
        const isAskingForList = /\b(list|show\s*(all|me|leads)|names|who|details)\b/i.test(userMessage);

        let listText = '';
        if (leadsData.leads && leadsData.leads.length > 0) {
          listText = leadsData.leads.map(l => `• **${l.fullname}** ${l.company !== 'N/A' ? `(${l.company})` : ''} - Status: ${l.status || 'Active'}`).join('\n');
        }


        // ⚡ Direct Instant Response without 2nd LLM round-trip
        if (isAskingSpecificallyQualified) {
          replyText = `📊 There are currently **${qualifiedCount} qualified leads** in Microsoft Dynamics 365 (out of ${total} total leads).`;
        } else if (isAskingSpecificallyOpen) {
          replyText = `📊 There are currently **${openCount} open leads** in Microsoft Dynamics 365 (out of ${total} total leads).`;
        } else {
          replyText = `📊 There are currently **${total} total leads** recorded in your Dynamics 365 CRM (${qualifiedCount} Qualified, ${openCount} Open).`;
        }
      } else if (call.name === 'create_dynamics_task') {
        const resolved = await this.resolveTargetLead(userMessage, call.args && call.args.leadName, session, context);
        if (resolved.notFound) {
          replyText = `⚠️ Could not find a lead matching "${resolved.leadName}" in Dynamics 365 to assign this task to.`;
        } else {
          const targetLeadId = resolved.leadId;
          const targetLeadName = resolved.leadName;

          const taskRes = await dynamicsService.createTask({
            leadId: targetLeadId,
            leadName: targetLeadName,
            subject: call.args.subject,
            dueDate: call.args.dueDate,
            description: call.args.description,
            priority: call.args.priority !== undefined ? call.args.priority : 1,
          });

          const userTz = session.userTimezone || 'Asia/Kolkata';
          const formattedDue = taskRes.dueDate ? new Date(taskRes.dueDate).toLocaleString('en-US', { timeZone: userTz, dateStyle: 'medium', timeStyle: 'short' }) : 'Tomorrow 5:00 PM';

          replyText = taskRes.success
            ? `📝 **Task Created in Microsoft Dynamics 365!**\n\n- **Subject:** ${taskRes.subject}\n- **Regarding:** ${targetLeadName || 'General Follow-up'}\n- **Due Date:** ${formattedDue} (${userTz})\n- **Priority:** ${taskRes.priority}\n\nThe task is now live on the Dynamics 365 Timeline!`
            : `⚠️ Failed to create task: ${taskRes.error}`;
        }

      } else if (call.name === 'query_dynamics_tasks') {
        let targetLeadId = null;
        if (call.args && call.args.leadName) {
          const searchRes = await dynamicsService.findLeadForDelete(call.args.leadName);
          if (searchRes.found && searchRes.leads && searchRes.leads.length > 0) {
            targetLeadId = searchRes.leads[0].leadid;
          }
        }

        const taskRes = await dynamicsService.getTasks({
          leadId: targetLeadId,
          top: 15,
        });

        const userTz = session.userTimezone || 'Asia/Kolkata';
        const nowInUserTz = new Date().toLocaleString('en-US', { timeZone: userTz, dateStyle: 'full', timeStyle: 'short' });
        const todayDateOnly = new Date().toLocaleDateString('en-US', { timeZone: userTz });

        if (taskRes && taskRes.found && taskRes.tasks.length > 0) {
          const taskDetails = taskRes.tasks.map(t => {
            const dueStr = t.dueDate ? new Date(t.dueDate).toLocaleString('en-US', { timeZone: userTz, dateStyle: 'medium', timeStyle: 'short' }) : 'N/A';
            const dueDateOnly = t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-US', { timeZone: userTz }) : '';
            const isToday = dueDateOnly === todayDateOnly;
            return `- Subject: "${t.subject}" | Due Date: ${dueStr} (isToday: ${isToday}) | Priority: ${t.priority} | Status: ${t.status}`;
          }).join('\n');

          const prompt = `You are an AI Sales Copilot integrated into Microsoft Dynamics 365.
The user asked: "${userMessage}"
Current Date and Time for user: ${nowInUserTz} (${userTz})

Dynamics 365 Task Records:
${taskDetails}

RULES:
1. If the user asked about tasks for TODAY (e.g. "today any task", "tasks for today", "is there anything today", "to day any task"):
   - If none of the tasks have due dates today (isToday: true), explicitly state that there are NO tasks scheduled for today in Dynamics 365.
   - Mention the next upcoming task(s) and its date so the user has full context.
   - If there ARE tasks due today, list those tasks due today.
2. If the user asked about TOMORROW, check if any task is due tomorrow.
3. If the user asked generally for all tasks, list the tasks neatly.
4. Keep the response natural, clear, and concise.`;

          try {
            const followRes = await this.genAI.getGenerativeModel({ model: successfulModel || this.modelName || 'gemini-3.1-flash-lite' }).generateContent(prompt);
            replyText = followRes.response.text();
          } catch (e) {
            const isTodayQuery = /\b(today|to\s*day)\b/i.test(userMessage);
            const todayTasks = taskRes.tasks.filter(t => t.dueDate && new Date(t.dueDate).toLocaleDateString('en-US', { timeZone: userTz }) === todayDateOnly);
            if (isTodayQuery) {
              if (todayTasks.length > 0) {
                const list = todayTasks.map(t => `• **${t.subject}** (${new Date(t.dueDate).toLocaleTimeString('en-US', { timeZone: userTz, timeStyle: 'short' })})`).join('\n');
                replyText = `📅 **Tasks Scheduled for Today:**\n\n${list}`;
              } else {
                replyText = `📅 **No tasks are scheduled for today** in Microsoft Dynamics 365.`;
              }
            } else {
              const list = taskRes.tasks.map(t => `• **${t.subject}** (Due: ${t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-US', { timeZone: userTz }) : 'N/A'})`).join('\n');
              replyText = `📝 **Scheduled Tasks in Dynamics 365:**\n\n${list}`;
            }
          }
        } else {
          replyText = `📋 There are currently no open tasks found in Dynamics 365.`;
        }
      } else if (call.name === 'delete_dynamics_lead') {
        const resolved = await this.resolveTargetLead(userMessage, call.args && call.args.leadName, session, context);
        let leadObj = null;

        if (resolved.notFound) {
          replyText = `❌ No lead found in **Dynamics 365** matching **"${resolved.leadName || call.args?.leadName || 'this lead'}"** to delete.\n\nPlease check the name and try again.`;
        } else {
          if (resolved.leadId) {
            const byId = await dynamicsService.getLeadById(resolved.leadId);
            if (byId) {
              leadObj = {
                leadid: byId.leadid,
                fullname: byId.fullname,
                company: byId.company,
                email: byId.email,
                phone: byId.phone,
                createdOn: new Date().toISOString(),
              };
            }
          }

          if (!leadObj && resolved.leadName) {
            const searchRes = await dynamicsService.findLeadForDelete(resolved.leadName);
            if (searchRes.found && searchRes.leads && searchRes.leads.length > 0) {
              leadObj = searchRes.leads[0];
            }
          }

          if (leadObj) {
            session.pendingDelete = leadObj;
            replyText = `⚠️ **Delete Confirmation Required**\n\n🗑️ You are about to **permanently delete** this lead from Dynamics 365:\n\n` +
              `* 👤 **Name:** ${leadObj.fullname}\n` +
              `* 🏢 **Company:** ${leadObj.company || 'N/A'}\n` +
              `* 📧 **Email:** ${leadObj.email || 'N/A'}\n` +
              `* 📞 **Phone:** ${leadObj.phone || 'N/A'}\n\n` +
              `❗ **This action is permanent and cannot be undone!**\n\nType **"yes"** to confirm delete, or **"no"** to cancel.`;
          } else {
            replyText = `❌ No lead found in **Dynamics 365** matching **"${call.args?.leadName || resolved.leadName || 'this lead'}"** to delete.`;
          }
        }
      }

      session.messages.push({ role: 'assistant', content: replyText });
      return { reply: replyText, leadCreated };
    }

    const replyText = result.response.text();
    session.messages.push({ role: 'assistant', content: replyText });
    return { reply: replyText, leadCreated: null };
  }



  /**
   * Smart Rule-based Engine for Sales Team & Admins
   */
  async smartRuleEngine(session, message, context = {}) {
    const text = message.toLowerCase();
    let reply = '';
    let leadCreated = null;



    // ✅ STEP 2: Handle delete confirmation — user said yes/confirm after pending delete
    if (session.pendingDelete) {
      const isConfirmed = /\byes\b/.test(text) || /\bconfirm\b/.test(text) ||
        /\bproceed\b/.test(text) || /\bok\b/.test(text) || /\bdone\b/.test(text) || /\bdelete\b/.test(text);
      const isCancelled = /\bno\b/.test(text) || /\bcancel\b/.test(text) || /\bstop\b/.test(text);

      if (isConfirmed) {
        const { leadid, fullname } = session.pendingDelete;
        session.pendingDelete = null;

        const result = await dynamicsService.deleteLead(leadid, fullname);

        if (result.success) {
          reply = `✅ **Lead Deleted Successfully!**\n\n🗑️ **${fullname}** has been permanently removed from **Microsoft Dynamics 365**.\n\n📌 This action cannot be undone. The lead record has been deleted from your CRM.`;
        } else {
          reply = `❌ **Delete Failed!**\n\nCould not delete **${fullname}** from Dynamics 365.\n\n**Error:** ${result.error || 'Unknown error'}\n\nPlease check CRM permissions or try manually from the Sales Hub.`;
        }

        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };

      } else if (isCancelled) {
        const { fullname } = session.pendingDelete;
        session.pendingDelete = null;
        reply = `🚫 **Cancelled.** Lead **${fullname}** was NOT deleted. No changes made to Dynamics 365.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };

      } else {
        // Unclear response — re-ask
        const { fullname } = session.pendingDelete;
        reply = `⚠️ Please confirm: Type **"yes"** to permanently delete **${fullname}**, or **"no"** to cancel.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }
    }

    // ✅ Handle convert-to-opportunity confirmation
    if (session.pendingConvert) {
      const isConfirmed = /\byes\b/.test(text) || /\bconfirm\b/.test(text) ||
        /\bproceed\b/.test(text) || /\bok\b/.test(text) || /\bdone\b/.test(text) || /\bconvert\b/.test(text);
      const isCancelled = /\bno\b/.test(text) || /\bcancel\b/.test(text) || /\bstop\b/.test(text);

      if (isConfirmed) {
        const { leadid, fullname } = session.pendingConvert;
        session.pendingConvert = null;

        const result = await dynamicsService.qualifyLead(leadid, fullname);

        if (result.success) {
          reply = `🌟 **Lead Converted to Opportunity!**\n\n💼 **${fullname}** has been successfully qualified in **Microsoft Dynamics 365**.\n\n` +
            `* 🏆 **Opportunity ID:** \`${result.opportunityId}\`\n` +
            `* 📊 **Status:** Qualified (Active Opportunity)\n` +
            `* 📁 **Contact Created:** Yes\n\n` +
            `📌 The Opportunity is now live in your **Dynamics 365 Sales Hub** under Opportunities!`;
        } else {
          reply = `❌ **Conversion Failed!**\n\nCould not convert **${fullname}** to Opportunity.\n\n**Error:** ${result.error || result.reason || 'Unknown error'}\n\nPlease check CRM permissions or convert manually from Sales Hub.`;
        }

        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };

      } else if (isCancelled) {
        const { fullname } = session.pendingConvert;
        session.pendingConvert = null;
        reply = `🚫 **Cancelled.** Lead **${fullname}** was NOT converted. No changes made to Dynamics 365.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };

      } else {
        const { fullname } = session.pendingConvert;
        reply = `⚠️ Please confirm: Type **"yes"** to convert **${fullname}** to Opportunity, or **"no"** to cancel.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }
    }

    // ✅ Detect convert-to-opportunity intent
    if (
      (text.includes('convert') || text.includes('qualify') || text.includes('move to opportunity') ||
        text.includes('convert lead') || text.includes('lead to opportunity') ||
        text.includes('make opportunity') || text.includes('create opportunity')) &&
      (text.includes('lead') || text.includes('opportunity') || /[a-z]+ [a-z]+/.test(text))
    ) {
      // Extract name from message
      const STOPWORDS_C = /\b(convert|qualify|lead|to|opportunity|from|in|the|make|create|move|please|ni|nu|na|ne|no|kro|karo|do|kari|aa|this)\b/gi;
      let convertName = message.replace(STOPWORDS_C, '').replace(/\s+/g, ' ').trim();

      // Gujarati / Hinglish match: "[Name] ni lead convert kro"
      if (!convertName || convertName.length < 2) {
        const gujConvertMatch = message.match(/^([A-Za-z\s]{2,40}?)\s*(?:ni|nu|na|ne|no)?\s*(?:lead)?\s*(?:convert|qualify)\s*(?:kro|karo|do)?/i);
        if (gujConvertMatch && gujConvertMatch[1]) {
          convertName = gujConvertMatch[1].replace(/\b(lead|opportunity|crm|dynamics|this)\b/gi, '').trim();
        }
      }

      // Try capitalized words
      if (!convertName || convertName.length < 2) {
        const caps = message.match(/\b[A-Z][a-z]{1,20}(\s+[A-Z][a-z]{1,20})?\b/g) || [];
        convertName = caps[0] || '';
      }

      if (!convertName || convertName.length < 2) {
        convertName = context.currentLeadName || session.currentLeadName || '';
      }

      if (!convertName || convertName.length < 2) {
        reply = `⚠️ Please specify which lead to qualify to Opportunity.\n\nExample:\n*"Qualify Rahul Desai lead to opportunity"*`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      // Find lead in CRM
      const searchResult = await dynamicsService.findLeadForDelete(convertName);

      if (!searchResult.found || !searchResult.leads || searchResult.leads.length === 0) {
        reply = `❌ No lead found in **Dynamics 365** matching **"${convertName}"**.\n\nPlease check the name and try again.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      const lead = searchResult.leads[0];
      session.pendingConvert = lead;

      reply = `💼 **Convert to Opportunity — Confirmation Required**\n\n` +
        `🌟 You are about to **convert this lead** into an active **Opportunity** in Dynamics 365:\n\n` +
        `* 👤 **Name:** ${lead.fullname}\n` +
        `* 🏢 **Company:** ${lead.company}\n` +
        `* 📧 **Email:** ${lead.email}\n` +
        `* 📞 **Phone:** ${lead.phone}\n` +
        `* 📅 **Created:** ${new Date(lead.createdOn).toLocaleDateString('en-IN')}\n\n` +
        `✅ **This will:**\n- Set Lead status to **Qualified**\n- Create a new **Opportunity** record\n- Create a **Contact** record\n\n` +
        `Type **"yes"** to convert, or **"no"** to cancel.`;

      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // ✅ STEP 1: Detect delete intent — "delete lead", "remove lead", "delete Rina Patel", "rina patel ni lead delete kro"
    if (
      (text.includes('delete') || text.includes('remove') || text.includes('erase') ||
        text.includes('drop lead') || text.includes('wipe lead') || text.includes('kadhi') || text.includes('hatao')) &&
      (text.includes('lead') || text.includes('contact') || text.includes('record') ||
        /[a-z]+ [a-z]+/.test(text) || text.includes('aa') || text.includes('this') || text.includes('kro') || text.includes('karo'))
    ) {
      let searchName = '';
      const activeLeadName = context.currentLeadName || session.currentLeadName;

      // 1. Check if user is asking to delete current/active lead: "aa lead delete kro", "delete this lead", "delete kro"
      const isCurrentLead = /\b(this|aa|current|active)\b/i.test(text) ||
        /^(\s*(?:delete|remove|erase)\s*(?:lead)?\s*(?:kro|karo|do)?\s*)$/i.test(text.trim()) ||
        /^(\s*(?:lead)?\s*(?:delete|remove)\s*(?:kro|karo|do)?\s*)$/i.test(text.trim());

      if (isCurrentLead && activeLeadName) {
        searchName = activeLeadName;
      }

      // 2. Gujarati / Hinglish pattern: "[Name] ni/ne/nu/na lead delete kro/karo"
      if (!searchName) {
        const gujMatch = message.match(/^([A-Za-z\s]{2,40}?)\s*(?:ni|nu|na|ne|no)?\s*(?:lead|record|contact)?\s*(?:delete|remove|erase|kadhi|hatao)\s*(?:kro|karo|do|nakho|nakh)?$/i);
        if (gujMatch && gujMatch[1]) {
          const candidate = gujMatch[1].replace(/\b(lead|record|contact|crm|dynamics|aa|this)\b/gi, '').trim();
          if (candidate.length > 1 && !['kro', 'karo', 'do', 'kar', 'kari', 'delete', 'remove', 'aa', 'this'].includes(candidate.toLowerCase())) {
            searchName = candidate;
          }
        }
      }

      // 3. English patterns: "delete lead of [Name]", "delete [Name]'s lead", "delete [Name]"
      if (!searchName) {
        const deletePatterns = [
          /(?:delete|remove|erase)\s+(?:lead\s+(?:of|for)?\s*)?([A-Za-z\s]{2,40})(?:'s)?(?:\s+lead|\s+record|\s+contact)?(?:\s+(?:kro|karo|do|from|in))?$/i,
          /(?:lead\s+of|lead\s+for)\s+([A-Za-z\s]{2,40})/i,
        ];

        for (const pattern of deletePatterns) {
          const match = message.match(pattern);
          if (match && match[1]) {
            const cleaned = match[1].replace(/\b(lead|record|contact|dynamics|crm|from|in|the|wipe|kro|karo|do|kar|kari)\b/gi, '').trim();
            if (cleaned.length > 1 && !['kro', 'karo', 'do', 'kar', 'kari', 'delete', 'remove', 'aa', 'this'].includes(cleaned.toLowerCase())) {
              searchName = cleaned;
              break;
            }
          }
        }
      }

      // 4. Fallback: dynamic stopword extraction with Gujarati particles removed
      if (!searchName || searchName.length < 2) {
        const STOPWORDS_D = /\b(delete|remove|erase|wipe|drop|lead|record|contact|from|in|dynamics|crm|the|a|an|please|can|you|i|want|to|ni|nu|na|ne|no|kro|karo|do|kari|kar|nakho|nakh|kadho|kadhi|hatao|aa|this)\b/gi;
        const cleaned = message.replace(STOPWORDS_D, '').replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleaned.length > 1 && !['kro', 'karo', 'do', 'kar', 'kari', 'delete', 'remove', 'aa', 'this'].includes(cleaned.toLowerCase())) {
          searchName = cleaned;
        }
      }

      // 5. If still no name found, fallback to active lead if user is on a lead page
      if ((!searchName || searchName.length < 2) && activeLeadName) {
        searchName = activeLeadName;
      }

      if (!searchName || searchName.length < 2) {
        reply = `⚠️ Please specify which lead to delete. Example:\n*"Delete Rina Patel's lead from Dynamics"*`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      // Search for the lead in Dynamics 365
      const searchResult = await dynamicsService.findLeadForDelete(searchName);

      if (!searchResult.found || !searchResult.leads || searchResult.leads.length === 0) {
        reply = `❌ No lead found in **Dynamics 365** matching **"${searchName}"**.\n\nPlease check the name and try again.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      // Found — show details and ask for confirmation
      const lead = searchResult.leads[0];
      session.pendingDelete = lead; // store for step 2

      const multipleFound = searchResult.leads.length > 1
        ? `\n\n⚠️ **${searchResult.leads.length} leads found** with this name. The most recent one will be deleted.`
        : '';

      reply = `⚠️ **Delete Confirmation Required**${multipleFound}\n\n🗑️ You are about to **permanently delete** this lead from Dynamics 365:\n\n` +
        `* 👤 **Name:** ${lead.fullname}\n` +
        `* 🏢 **Company:** ${lead.company}\n` +
        `* 📧 **Email:** ${lead.email}\n` +
        `* 📞 **Phone:** ${lead.phone}\n` +
        `* 📅 **Created:** ${new Date(lead.createdOn).toLocaleDateString('en-IN')}\n\n` +
        `❗ **This action is permanent and cannot be undone!**\n\nType **"yes"** to confirm delete, or **"no"** to cancel.`;

      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // ✅ Detect Task creation intent: "create task", "add task", "new task", "task for", "set task"
    const isTaskIntent = (
      (text.includes('task') || text.includes('to-do') || text.includes('todo') || text.includes('follow-up') || text.includes('follow up')) &&
      (text.includes('create') || text.includes('add') || text.includes('new') || text.includes('for') || text.includes('set') || text.includes('make') || text.startsWith('task:'))
    );

    if (isTaskIntent) {
      let taskTargetName = '';
      const nameWithMatch = message.match(/(?:for|with|regarding)\s+([A-Za-z\s]+?)(?:\s*:|\s+tomorrow|\s+today|\s+by|\s+on|\s+at|\s+next|\s+due|\.|\?|$|,)/i);
      if (nameWithMatch && nameWithMatch[1]) {
        taskTargetName = nameWithMatch[1]
          .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|at|on|next|this|week|task|due|by|lead)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      if (!taskTargetName || taskTargetName.length < 2) {
        const STOPWORDS_TASK = /\b(Task|Create|Add|New|Dynamics|Sales|Copilot|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Next|This|At|On|For|With|By|Due)\b/i;
        const words = message.split(/\s+/).filter(w => !STOPWORDS_TASK.test(w) && /^[A-Z][a-z]{1,20}$/.test(w));
        if (words.length > 0) {
          taskTargetName = words.slice(0, 2).join(' ');
        }
      }

      const currentLeadId = context.currentLeadId || session.currentLeadId;
      const currentLeadName = context.currentLeadName || session.currentLeadName;
      if (!taskTargetName && currentLeadName) {
        taskTargetName = currentLeadName;
      }

      // Extract subject
      let taskSubject = 'Follow up with client';
      const colonMatch = message.match(/:\s*(.+)$/);
      if (colonMatch && colonMatch[1]) {
        taskSubject = colonMatch[1].replace(/\s*(?:by|at|due)\s+.*$/i, '').trim();
      } else {
        const cleanSubj = message.replace(/(?:create|add|new|set|make)\s+task\s*(?:for\s+[A-Za-z\s]+)?/i, '')
          .replace(/\s*(?:by|at|due)\s+.*$/i, '')
          .trim();
        if (cleanSubj.length > 2) taskSubject = cleanSubj;
      }

      // Find lead
      let targetLead = null;
      if (!taskTargetName && currentLeadId) {
        targetLead = await dynamicsService.getLeadById(currentLeadId);
      }
      const searchTarget = taskTargetName || currentLeadName;
      if (searchTarget) {
        const searchResult = await dynamicsService.findLeadForDelete(searchTarget);
        if (searchResult.found && searchResult.leads && searchResult.leads.length > 0) {
          targetLead = searchResult.leads[0];
        }
      }

      const leadId = targetLead ? targetLead.leadid : currentLeadId;
      const leadName = targetLead ? targetLead.fullname : taskTargetName;

      const taskResult = await dynamicsService.createTask({
        leadId,
        leadName,
        subject: taskSubject,
        dueDate: message,
        description: `Created via Sales AI Copilot for ${leadName || 'Client'}. Subject: ${taskSubject}`,
        priority: 1,
      });

      if (taskResult.success) {
        const userTz = session.userTimezone || 'Asia/Kolkata';
        const dueStr = taskResult.dueDate ? new Date(taskResult.dueDate).toLocaleString('en-US', { timeZone: userTz, dateStyle: 'medium', timeStyle: 'short' }) : 'Tomorrow 5:00 PM';

        reply = `📝 **Task Successfully Created in Dynamics 365!** 🚀\n\n` +
          `* 👤 **Regarding:** ${leadName || 'General Follow-up'}\n` +
          `* 📌 **Subject:** ${taskResult.subject}\n` +
          `* 🕒 **Due Date:** ${dueStr} (${userTz})\n` +
          `* ⚡ **Priority:** ${taskResult.priority}\n` +
          `* 🆔 **Task ID:** \`${taskResult.taskId}\`\n\n` +
          `✅ **Now Live in CRM:** Added to the Lead's Timeline in Microsoft Dynamics 365!`;
      } else {
        reply = `❌ **Failed to create task in Dynamics 365:**\n\n${taskResult.error || 'Unknown error'}\n\nPlease check CRM permissions.`;
      }

      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // ✅ Detect Appointment / Meeting creation intent: "schedule appointment", "book meeting", "create appointment", etc.
    const isApptIntent = (
      (text.includes('appointment') || text.includes('meeting') || text.includes('schedule') ||
        text.includes('book call') || text.includes('book meeting') || text.includes('set up demo') ||
        text.includes('book appointment') || text.includes('demo with')) &&
      !text.includes('cancel')
    );

    if (isApptIntent) {
      // 1. Extract Lead / Prospect Name:
      let apptTargetName = '';
      const nameWithMatch = message.match(/(?:with|for)\s+([A-Za-z\s]+?)(?:\s+tomorrow|\s+today|\s+on|\s+at|\s+for|\s+regarding|\s+next|\s+this|\s+monday|\s+tuesday|\s+wednesday|\s+thursday|\s+friday|\s+saturday|\s+sunday|\.|\?|$|,)/i);
      if (nameWithMatch && nameWithMatch[1]) {
        apptTargetName = nameWithMatch[1]
          .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|at|on|next|this|week|appointment|meeting|demo|call|lead)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Fallback: search capitalized words excluding stopwords
      if (!apptTargetName || apptTargetName.length < 2) {
        const STOPWORDS_APPT = /\b(Schedule|Appointment|Meeting|Demo|Call|Book|Create|Dynamics|Sales|Copilot|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Next|This|At|On|For|With)\b/i;
        const words = message.split(/\s+/).filter(w => !STOPWORDS_APPT.test(w) && /^[A-Z][a-z]{1,20}$/.test(w));
        if (words.length > 0) {
          apptTargetName = words.slice(0, 2).join(' ');
        }
      }

      // Fallback: check currently open lead from context or session
      const currentLeadId = context.currentLeadId || session.currentLeadId;
      const currentLeadName = context.currentLeadName || session.currentLeadName;
      if (!apptTargetName && currentLeadName) {
        apptTargetName = currentLeadName;
      }

      // Extract subject:
      let subject = 'Product Demo & Sales Consultation';
      if (text.includes('demo')) subject = 'Product Demo & Technical Overview';
      else if (text.includes('pricing') || text.includes('quote')) subject = 'Commercial & Pricing Discussion';
      else if (text.includes('follow up') || text.includes('followup')) subject = 'Sales Follow-up Meeting';
      else if (text.includes('call')) subject = 'Discovery Call with Client';

      const subjMatch = message.match(/(?:subject:?|topic:?|purpose:?)\s*([^,;.\n]+)/i);
      if (subjMatch && subjMatch[1]) {
        subject = subjMatch[1].trim();
      }

      // Extract date/time:
      let apptDate = new Date();
      // default: tomorrow at 11:00 AM
      apptDate.setDate(apptDate.getDate() + 1);
      apptDate.setHours(11, 0, 0, 0);

      if (text.includes('today')) {
        apptDate = new Date();
        apptDate.setHours(apptDate.getHours() + 2, 0, 0, 0);
      } else if (text.includes('tomorrow')) {
        apptDate = new Date();
        apptDate.setDate(apptDate.getDate() + 1);
        apptDate.setHours(11, 0, 0, 0);
      }

      // Day of week handling (e.g. Tuesday)
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      for (let i = 0; i < 7; i++) {
        if (text.includes(days[i])) {
          const todayDay = new Date().getDay();
          let diff = i - todayDay;
          if (diff <= 0) diff += 7; // next occurrence
          apptDate = new Date();
          apptDate.setDate(apptDate.getDate() + diff);
          apptDate.setHours(11, 0, 0, 0);
          break;
        }
      }

      // Extract time like "at 3 pm", "at 5pm", "at 4:30 pm", "at 17:00"
      const timeMatch = message.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i) || message.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
        const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;
        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        apptDate.setHours(hours, minutes, 0, 0);
      }

      // Search for the Lead in Dynamics 365
      let targetLead = null;

      // 1. If currently open lead ID is available and user didn't specify another name
      if (!apptTargetName && currentLeadId) {
        targetLead = await dynamicsService.getLeadById(currentLeadId);
      }

      // 2. Search by extracted or context name
      const searchTarget = apptTargetName || currentLeadName;
      if (searchTarget) {
        const searchResult = await dynamicsService.findLeadForDelete(searchTarget);
        if (searchResult.found && searchResult.leads && searchResult.leads.length > 0) {
          targetLead = searchResult.leads[0];
        } else if (searchTarget.includes(' ')) {
          // Try first name only
          const firstNameRes = await dynamicsService.findLeadForDelete(searchTarget.split(' ')[0]);
          if (firstNameRes.found && firstNameRes.leads && firstNameRes.leads.length > 0) {
            targetLead = firstNameRes.leads[0];
          }
        }
      }

      if (!targetLead) {
        reply = `⚠️ Please specify the client name for the meeting, or open their Lead in Dynamics 365.\n\nExample:\n*"Book meeting with Rahul Desai Tuesday at 5PM"*`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      const leadId = targetLead.leadid;
      const leadName = targetLead.fullname;
      const company = targetLead.company || '';

      const apptResult = await dynamicsService.createAppointment({
        leadId,
        leadName,
        subject,
        startTime: apptDate.toISOString(),
        durationMinutes: 30,
        description: `Scheduled by Sales Copilot AI for ${leadName} (${company || 'Prospect'}).\nPurpose: ${subject}\nChannel: Microsoft Dynamics 365 Sales Hub`,
      });

      if (apptResult.success) {
        const dateStr = apptDate.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = apptDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        reply = `📅 **Appointment Successfully Scheduled in Dynamics 365!** 🚀\n\n` +
          `* 👤 **Regarding Lead:** ${leadName} ${company ? `*(${company})*` : ''}\n` +
          `* 📌 **Subject:** ${subject}\n` +
          `* 🕒 **Date & Time:** ${dateStr} at ${timeStr} (30 mins)\n` +
          `* 🆔 **Appointment ID:** \`${apptResult.appointmentId}\`\n` +
          `* 📁 **Status:** Scheduled (Open Activity)\n\n` +
          `✅ **Now Live in CRM:**\n` +
          `- Visible in **"Up next"** activity card on this Lead\n` +
          `- Added to the **Timeline** stream\n` +
          `- Ready for Outlook Calendar / Teams sync`;
      } else {
        reply = `❌ **Failed to schedule appointment in Dynamics 365:**\n\n${apptResult.error || 'Unknown error'}\n\nPlease check CRM permissions.`;
      }

      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // ✅ Detect "show last/latest/most recent lead" — fetch actual newest lead from Dynamics 365
    // ⚠️ This MUST come before the general search block (which also matches 'recent')
    if (
      text.includes('recent lead') || text.includes('latest lead') || text.includes('last lead') ||
      text.includes('see last') || text.includes('show last') || text.includes('most recent') ||
      text.includes('newest lead') || text.includes('last added') || text.includes('last created') ||
      text.includes('last entry') || text.includes('new entry')
    ) {
      const result = await dynamicsService.getAllLeads(1);
      const leads = result.leads || [];

      if (leads.length === 0) {
        reply = `📋 **No leads found** in Dynamics 365 yet.\n\n➕ To log a new lead, say:\n*"Add lead: John Doe, john@company.com, 9876543210, interested in Growth Suite."*`;
      } else {
        const lead = leads[0];
        reply = `📋 **Latest Lead in Dynamics 365** *(${result.source})*\n\n` +
          `* 👤 **Name:** ${lead.fullname || 'N/A'}\n` +
          `* 🏢 **Company:** ${lead.company || 'N/A'}\n` +
          `* 📧 **Email:** ${lead.email || 'N/A'}\n` +
          `* 📞 **Phone:** ${lead.phone || 'N/A'}\n` +
          `* 📅 **Created:** ${new Date(lead.createdOn).toLocaleString('en-IN')}\n\n` +
          `📌 This is the **most recently created lead** in your Dynamics 365 Sales Hub.`;
      }

      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // ✅ Detect Update Lead Intent (e.g. "Add phone number 9099158859 to Rina Patel’s lead record", "update website Yahoo.com")
    const phoneInMsg = message.match(/(?:\+?\d{1,4}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}|\b\d{10}\b/);
    const emailInMsg = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const websiteInMsg = message.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.(?:com|org|net|io|in|co|ai|tech|me|edu)(?:\/[^\s]*)?/i);

    const isCreateLeadCommand = /\b(add\s+lead|create\s+lead|log\s+lead|new\s+lead|save\s+lead|insert\s+lead|record\s+lead)\b/i.test(text);

    const isUpdateFieldIntent = !isCreateLeadCommand && (
      (text.includes('update') || text.includes('change') || text.includes('set') || text.includes('upade') || (text.includes('add') && (text.includes('phone') || text.includes('number') || text.includes('email') || text.includes('website')))) &&
      (text.includes('phone') || text.includes('mobile') || text.includes('number') || text.includes('email') || text.includes('company') || text.includes('website') || text.includes('site') || Boolean(websiteInMsg))
    );

    if (isUpdateFieldIntent) {
      let updateTargetName = '';

      // Pattern: "to [Name]'s lead record", "for [Name]", "to [Name]"
      const namePatterns = [
        /(?:to|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:'s|’s|\s+lead|\s+record|\.|\?|$)/i,
        /(?:update|change|set)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:'s|’s|\s+phone|\s+email|\s+mobile|\s+website|\s+lead)/i,
        /(?:phone|mobile|number|email|website)\s+(?:of|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      ];

      for (const p of namePatterns) {
        const m = message.match(p);
        if (m && m[1]) {
          const candidate = m[1].replace(/\b(lead|record|profile|dynamics|crm|phone|mobile|number|website)\b/gi, '').trim();
          if (candidate.length > 1) {
            updateTargetName = candidate;
            break;
          }
        }
      }

      // Check active lead context first if available
      const currentLeadId = context.currentLeadId || session.currentLeadId;
      const currentLeadName = context.currentLeadName || session.currentLeadName;
      if (!updateTargetName && currentLeadName) {
        updateTargetName = currentLeadName;
      }

      // Fallback: search capitalized words excluding stopwords
      if (!updateTargetName || updateTargetName.length < 2) {
        const STOPWORDS_U = /\b(add|the|phone|mobile|number|to|for|lead|record|crm|dynamics|update|upade|change|set|contact|agent|website|site|yahoo|google)\b/gi;
        const caps = message.match(/\b[A-Z][a-z]{1,20}(\s+[A-Z][a-z]{1,20})?\b/g) || [];
        const filtered = caps.filter(w => !STOPWORDS_U.test(w) && w.length > 1);
        if (filtered.length > 0) updateTargetName = filtered[0];
      }

      // Fallback 2: dynamic extraction by stripping numbers and action words
      if (!updateTargetName || updateTargetName.length < 2) {
        const STOPWORDS_U_FALLBACK = /\b(add|update|upade|change|set|put|save|phone|mobile|telephone|cell|number|email|website|to|for|lead|record|profile|crm|dynamics|contact|agent|please)\b/gi;
        const cleaned = message
          .replace(/\b\d{5,15}\b/g, '') // remove phone number
          .replace(STOPWORDS_U_FALLBACK, '')
          .replace(/[^a-zA-Z\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned.length > 1) {
          updateTargetName = cleaned;
        }
      }

      if (!updateTargetName) {
        reply = `⚠️ Please specify which lead to update.\n\nExample:\n*"Update website Yahoo.com for Nidhip Desai"*`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      // Search lead in Dynamics 365
      let targetLead = null;
      if (currentLeadId && (!updateTargetName || updateTargetName.toLowerCase() === currentLeadName?.toLowerCase())) {
        targetLead = await dynamicsService.getLeadById(currentLeadId);
      }
      if (!targetLead) {
        const searchRes = await dynamicsService.findLeadForDelete(updateTargetName);
        if (searchRes.found && searchRes.leads && searchRes.leads.length > 0) {
          targetLead = searchRes.leads[0];
        }
      }

      if (!targetLead) {
        reply = `❌ No lead found in **Dynamics 365** matching **"${updateTargetName}"**.\n\nPlease check the name and try again.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      const targetPhone = phoneInMsg ? phoneInMsg[0] : null;
      const targetEmail = emailInMsg ? emailInMsg[0] : null;
      const targetWebsite = websiteInMsg ? websiteInMsg[0] : null;

      if (!targetPhone && !targetEmail && !targetWebsite) {
        reply = `⚠️ Please specify a valid phone number, email, or website to update for **${targetLead.fullname}**.`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      // Perform update via Dynamics 365 Web API PATCH
      const updateResult = await dynamicsService.updateLead(targetLead.leadid, targetLead.fullname, {
        phone: targetPhone,
        email: targetEmail,
        website: targetWebsite,
      });

      if (updateResult.success) {
        reply = `✅ **Lead Record Updated in Dynamics 365!** 📱\n\n` +
          `* 👤 **Lead Name:** ${targetLead.fullname}\n` +
          (targetPhone ? `* 📞 **Phone Number:** \`${targetPhone}\`\n` : '') +
          (targetEmail ? `* 📧 **Email:** \`${targetEmail}\`\n` : '') +
          (targetWebsite ? `* 🌐 **Website:** \`${targetWebsite}\`\n` : '') +
          `* 🏢 **Company:** ${targetLead.company}\n` +
          `* 🆔 **Lead ID:** \`${targetLead.leadid}\`\n\n` +
          `📌 The record has been updated directly in your **Microsoft Dynamics 365 Sales Hub**! (Click Refresh on the form to view changes).`;
      } else {
        reply = `❌ **Update Failed:** Could not update lead in Dynamics 365.\n\n**Error:** ${updateResult.error}`;
      }

      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // Detect sales rep asking for client info / lead search
    if (
      !isCreateLeadCommand && (
        text.includes('conversation') ||
        text.includes('history') ||
        text.includes('last talk') ||
        text.includes('notes') ||
        text.includes('details') ||
        text.includes('detail of') ||
        text.includes('summary') ||
        text.includes('who is') ||
        text.includes('search') ||
        text.includes('search for') ||
        text.includes('find lead') ||
        text.includes('find') ||
        text.includes('look up') ||
        text.includes('lookup') ||
        text.includes('show me') ||
        text.includes('get info') ||
        text.includes('check lead') ||
        text.includes('is there') ||
        text.includes('status of') ||
        text.includes('info on') ||
        text.includes('tell me about') ||
        text.includes('what do you know about') ||
        text.includes('lead for') ||
        text.includes('about') ||
        text.includes('what happened') ||
        text.includes('last time') ||
        text.includes('search lead') ||
        text.includes('information about')
      )) {
      let searchTerm = '';
      const STOPWORDS = /\b(find|lead|for|look|up|lookup|search|details|info|tell|me|about|status|of|check|show|get|what|who|is|there|last|conversation|recent|summary|notes|talk|crm|dynamics|with|regarding|related|concerning|the|a|an|in|on|at|by|from|to|and|or|please|can|you|do|know|have|was|were|are|history|time|happened|information)\b/gi;

      // Step 1: Try to extract name using regex patterns (fixed greedy {2,40})
      const patterns = [
        /(?:find lead for|find|look up|lookup|search for|details of|info on|tell me about|about|status of|lead for|check|show me)\s+([A-Za-z\s]{2,40})(?:\?|$|\.|\,|\bin\b)/i,
        /(?:with|about|for|of|regarding|related to|concerning)\s+([A-Za-z0-9\s]{2,40})(?:\?|$|\.|\,)/i,
      ];

      for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
          searchTerm = match[1].replace(STOPWORDS, '').replace(/\s+/g, ' ').trim();
          if (searchTerm.length > 1) break;
        }
      }

      // Step 2: Dynamic fallback — extract any capitalized word(s) from message
      // No hardcoded names — works for ANY name the user types
      if (!searchTerm || searchTerm.length < 2) {
        const capitalizedWords = message.match(/\b[A-Z][a-z]{1,20}(\s+[A-Z][a-z]{1,20})?\b/g) || [];
        const filtered = capitalizedWords.filter(w => !STOPWORDS.test(w) && w.length > 1);
        if (filtered.length > 0) {
          searchTerm = filtered[0]; // pick first meaningful name found
        }
      }

      // Step 3: Dynamic fallback 2 — strip all stopwords, use whatever remains
      if (!searchTerm || searchTerm.length < 2) {
        searchTerm = message.replace(STOPWORDS, '').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        if (searchTerm.length < 2) searchTerm = '';
      }

      // ⚠️ No name found — ask user to specify instead of guessing
      if (!searchTerm || searchTerm.length < 2) {
        reply = `🔍 Please specify a **client name or company** to search.\n\nExample:\n*"Find lead for Avani Shah"*\n*"Details of Webtual Technologies"*\n*"What was the last conversation with Rahul Mehta?"*`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      const searchResult = await dynamicsService.searchLead(searchTerm);

      if (searchResult.found) {
        reply = `**Dynamics 365 CRM Record Found:** 📋\n\nHere is the latest info for **${searchResult.name}**:\n\n* 👤 **Lead Name:** ${searchResult.name}\n* 🏢 **Company:** ${searchResult.company || 'N/A'}\n* 📧 **Email:** ${searchResult.email || 'N/A'}\n* 📞 **Phone:** ${searchResult.phone || 'N/A'}\n* 📅 **Created:** ${new Date(searchResult.createdOn).toLocaleString('en-IN')}\n* 📝 **Notes:** ${searchResult.description || 'Inquired regarding Sales AI solutions.'}\n\n📌 **CRM Status:** Active in Dynamics 365 Sales Hub!`;
      } else {
        reply = `No matching record found in **Microsoft Dynamics 365** for **"${searchTerm}"**.\n\nWould you like me to **create a new lead** for this contact?`;
      }
      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // Detect sales rep instructing to send brochure to a prospect
    if (
      text.includes('send brochure') || text.includes('email brochure') ||
      text.includes('send pdf') || text.includes('send catalog') ||
      text.includes('send sales kit') || text.includes('email sales kit') ||
      text.includes('mail brochure')
    ) {
      const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      let targetEmail = emailMatch ? emailMatch[0] : null;
      let prospectName = 'Prospect';

      const nameMatch = message.match(/(?:to|for)\s+([A-Za-z\s]+?)(?:\sat|\swith|\s+on|$)/i);
      if (nameMatch && nameMatch[1]) {
        prospectName = nameMatch[1].replace(/\b(brochure|pdf|catalog|sales kit|the|email|mail|lead)\b/gi, '').trim();
      }

      // If a specific prospect name was given, look up that lead FIRST!
      const isGenericRule = !prospectName || /^(prospect|this lead|him|her|client|this)$/i.test(prospectName.trim());
      if (!targetEmail && !isGenericRule && prospectName.length > 1) {
        const leadRes = await dynamicsService.findLeadForDelete(prospectName);
        if (leadRes.found && leadRes.leads && leadRes.leads.length > 0) {
          const lead = leadRes.leads[0];
          if (lead.email && lead.email !== 'N/A' && lead.email.includes('@')) {
            targetEmail = lead.email;
            prospectName = lead.fullname;
          } else {
            reply = `⚠️ Lead **"${lead.fullname || prospectName}"** was found in Dynamics 365, but has no email address on file to send the brochure.`;
            session.messages.push({ role: 'assistant', content: reply });
            return { reply, leadCreated: null };
          }
        } else {
          reply = `❌ No lead found in **Dynamics 365** matching **"${prospectName}"** to send the brochure.\n\nPlease check the name or provide their email address directly.`;
          session.messages.push({ role: 'assistant', content: reply });
          return { reply, leadCreated: null };
        }
      }

      // Fall back to active lead context ONLY if NO specific prospect name was specified
      if (!targetEmail && isGenericRule) {
        const activeId = context.currentLeadId || session.currentLeadId;
        if (activeId) {
          try {
            const activeLead = await dynamicsService.getLeadById(activeId);
            if (activeLead && activeLead.email && activeLead.email.includes('@')) {
              targetEmail = activeLead.email;
              prospectName = activeLead.fullname || prospectName;
            }
          } catch (e) { }
        }
      }

      if (!targetEmail) {
        reply = `📧 Please specify an email address or lead name to send the brochure.\n\nExample:\n*"Email brochure to client@example.com"*\n*"Send brochure to Rina Patel"*`;
        session.messages.push({ role: 'assistant', content: reply });
        return { reply, leadCreated: null };
      }

      const emailResult = await emailService.sendBrochure(targetEmail, prospectName);

      reply = `Done! 🚀 I have dispatched the official **Product Brochure & Pricing Guide (PDF)** to **${targetEmail}** (${prospectName}) on your behalf.\n\n📄 **Attachment:** \`${emailResult.brochure}\`\n📧 **Status:** ${emailResult.status}`;
      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }

    // ✅ Detect pipeline / count / status queries — "how many leads", "pipeline status", etc.
    if (
      text.includes('how many') || text.includes('howmany') || text.includes('total lead') ||
      text.includes('pipeline status') || text.includes('recent lead') ||
      text.includes('all lead') || text.includes('lead count') ||
      text.includes('lead do we have') || text.includes('leads do we have') || text.includes('lead have') ||
      text.includes('show lead') || text.includes('list lead') ||
      text.includes('lead in crm') || text.includes('leads in crm') || text.includes('lead in dynamics') ||
      text.includes('leads recorded') || text.includes('ketla lead') ||
      (text.includes('pipeline') && (text.includes('status') || text.includes('show') || text.includes('check')))
    ) {
      // ✅ Fetch REAL leads from Dynamics 365 (not in-memory cache)
      const result = await dynamicsService.getAllLeads(10);
      const count = result.totalCount;
      const leads = result.leads || [];

      if (count === 0) {
        reply = `📊 **Dynamics 365 Pipeline Status**\n\n🔴 No leads found in the CRM yet.\n\n➕ To log a new lead, say:\n*"Add lead: John Doe, john@company.com, 9876543210, interested in Growth Suite."*`;
      } else {
        const leadsList = leads.slice(0, 8).map((lead, i) =>
          `${i + 1}. **${lead.fullname || 'Unknown'}** — ${lead.email || 'N/A'} | ${lead.company || 'N/A'}`
        ).join('\n');

        reply = `📊 **Dynamics 365 Pipeline Status** *(${result.source})*\n\n✅ **Total Leads in CRM: ${count}**\n\n**Recent Leads:**\n${leadsList}\n\n📌 All records are live in your **Dynamics 365 Sales Hub**.`;
      }

      session.messages.push({ role: 'assistant', content: reply });
      return { reply, leadCreated: null };
    }


    // Detect sales rep logging a new lead from a call or meeting
    const emailMatch = message.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = message.match(/(\+?\d{1,4}[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}|\d{10}/);

    if (isCreateLeadCommand || (emailMatch && (phoneMatch || text.includes('lead') || text.includes('add') || text.includes('create') || text.includes('call') || text.includes('client')))) {
      let extractedName = session.extractedLead.name;
      if (!extractedName) {
        const nameMatch = message.match(/(?:name is|client:?|spoke to|lead:?|contact:?)\s+(?:for\s+)?([A-Za-z\s]+?)(?:\,|\.|\;|\band\b|\bfrom\b|\bemail\b|\bphone\b|$)/i);
        if (nameMatch && nameMatch[1]) {
          extractedName = nameMatch[1].trim();
        } else {
          extractedName = message.split(',')[0].replace(/add\s+lead(?:\s+for)?|create\s+lead(?:\s+for)?|new\s+lead(?:\s+for)?|log\s+lead(?:\s+for)?|add|create|new lead|spoke to|client/gi, '').trim() || 'Enterprise Prospect';
        }
      }

      const targetEmail = emailMatch[0];
      const targetPhone = phoneMatch ? phoneMatch[0] : 'N/A';

      // Extract Company Name dynamically from input or message
      let extractedCompany = '';
      const companyMatch = message.match(/(?:company:?|comapny:?|compnay:?|organization:?|org:?|firm:?)\s*([^,;]+)/i);
      if (companyMatch && companyMatch[1]) {
        extractedCompany = companyMatch[1].trim();
      }

      if (!extractedCompany) {
        const fromMatch = message.match(/(?:from|at)\s+([A-Za-z0-9\s.&'-]+?)(?:\,|\.|\;|\band\b|\bemail\b|\bphone\b|\bnote\b|$)/i);
        if (fromMatch && fromMatch[1]) {
          const candidate = fromMatch[1].trim();
          if (candidate.length > 1 && !/^(call|phone|lead|email|inquiry)$/i.test(candidate)) {
            extractedCompany = candidate;
          }
        }
      }

      if (!extractedCompany) {
        const parts = message.split(',').map(p => p.trim());
        for (const p of parts) {
          if (p.toLowerCase().startsWith('company:') || p.toLowerCase().startsWith('comapny:')) {
            extractedCompany = p.replace(/^(?:company|comapny):\s*/i, '').trim();
            break;
          }
        }
      }

      if (!extractedCompany) {
        const parts = message.split(',').map(p => p.trim());
        for (let i = 1; i < parts.length; i++) {
          const candidate = parts[i];
          if (!candidate.includes('@') && !/\d{6,}/.test(candidate) && !/^(phone inquiry|call|inquiry)$/i.test(candidate) && !candidate.toLowerCase().startsWith('note')) {
            extractedCompany = candidate.replace(/^company:\s*/i, '').trim();
            break;
          }
        }
      }

      if (!extractedCompany && targetEmail) {
        const domain = targetEmail.split('@')[1]?.split('.')[0];
        const commonDomains = ['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'protonmail', 'zoho', 'rediffmail'];
        if (domain && !commonDomains.includes(domain.toLowerCase())) {
          extractedCompany = domain.charAt(0).toUpperCase() + domain.slice(1);
        }
      }

      if (!extractedCompany) {
        extractedCompany = 'Individual Prospect';
      }

      // Extract Note / Requirement
      let extractedNote = '';
      const noteMatch = message.match(/(?:note:?|notes:?|requirement:?|interest:?|interested in)\s*([^,;]+)/i);
      if (noteMatch && noteMatch[1]) {
        extractedNote = noteMatch[1].trim();
      } else {
        const parts = message.split(',');
        if (parts.length > 4) {
          extractedNote = parts.slice(4).join(',').trim();
        }
      }

      // 1. Create Lead in Dynamics 365
      leadCreated = await dynamicsService.createLead({
        fullname: extractedName,
        emailaddress1: targetEmail,
        mobilephone: targetPhone,
        companyname: extractedCompany,
        description: extractedNote ? `Client Requirement: ${extractedNote}. Logged via Sales AI Copilot.` : `Logged by Sales Rep via Sales AI Copilot. Notes: "${message}"`,
      });

      // 2. Dispatch brochure automatically
      const emailResult = await emailService.sendBrochure(targetEmail, extractedName);
      leadCreated.brochureDispatched = emailResult.brochure;

      reply = `Lead successfully logged! 🎯\n\n* 👤 **Lead Name:** ${extractedName}\n* 🏢 **Company:** ${extractedCompany}\n* 📧 **Email:** ${targetEmail}\n* 📞 **Phone:** ${targetPhone}\n* 🆔 **Dynamics 365 ID:** \`${leadCreated.id}\`\n\n📄 **Action Taken:** Auto-dispatched Sales Kit PDF to ${targetEmail}. The lead is now live in your **Dynamics 365 Sales Hub**!`;
      return { reply, leadCreated };
    }

    // Help menu for sales reps and admins
    reply = `Hello! 💼 I am your internal **Dynamics 365 Sales Copilot**.\n\nHere are commands you can give me:\n\n1. 🔍 **Client History:** *"What was the last conversation with Webtual Technologies?"*\n2. ➕ **Log New Lead:** *"Add lead: Ankit Shah, ashah@client.com, 9876543210, interested in Growth Suite."*\n3. 📧 **Send Sales Kit:** *"Email brochure to client@example.com"*\n4. 📊 **Pipeline Status:** Ask me about recent leads recorded in Dynamics 365.\n\nHow can I help you close deals today?`;

    session.messages.push({ role: 'assistant', content: reply });
    return { reply, leadCreated: null };
  }
}

module.exports = new AgentBrain();
