const msal = require('@azure/msal-node');
const https = require('https');
const axios = require('axios');
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });
require('dotenv').config();

// Store recent leads in memory for dashboard preview
const capturedLeadsHistory = [];

class DynamicsService {
  constructor() {
    this.crmUrl = (process.env.CRM_URL || '').replace(/\/+$/, '');
    this.tenantId = process.env.TENANT_ID;
    this.clientId = process.env.CLIENT_ID;
    this.clientSecret = process.env.CLIENT_SECRET;

    this.isConfigured = Boolean(
      this.crmUrl &&
      this.tenantId &&
      this.clientId &&
      this.clientSecret &&
      !this.crmUrl.includes('yourcompany') &&
      !this.tenantId.includes('YOUR_')
    );

    if (this.isConfigured) {
      this.cca = new msal.ConfidentialClientApplication({
        auth: {
          clientId: this.clientId,
          authority: `https://login.microsoftonline.com/${this.tenantId}`,
          clientSecret: this.clientSecret,
        },
      });
      console.log('✅ Dynamics 365 Dataverse Service Initialized for:', this.crmUrl);
    } else {
      console.log('⚠️ Dynamics 365 credentials not fully configured yet. Running in SIMULATION MODE.');
    }
  }

  /**
   * Acquire OAuth2 Access Token for Microsoft Dataverse
   */
  async getAccessToken() {
    if (!this.isConfigured) {
      throw new Error('Dynamics 365 credentials are not configured in .env');
    }

    const tokenRequest = {
      scopes: [`${this.crmUrl}/.default`],
    };

    const response = await this.cca.acquireTokenByClientCredential(tokenRequest);
    return response.accessToken;
  }

  /**
   * Create a new Lead in Dynamics 365 Sales
   */
  async createLead(leadData) {
    const timestamp = new Date().toISOString();
    const leadRecord = {
      id: 'LEAD-' + Date.now().toString().slice(-6),
      name: leadData.fullname || `${leadData.firstname || ''} ${leadData.lastname || ''}`.trim() || 'Website Visitor',
      email: leadData.emailaddress1 || leadData.email || 'N/A',
      phone: leadData.mobilephone || leadData.telephone1 || 'N/A',
      company: leadData.companyname || leadData.company || 'Individual',
      requirement: leadData.description || leadData.requirement || 'Sales Inquiry from AI Chat',
      status: 'Open - New',
      createdAt: timestamp,
      mode: this.isConfigured ? 'Dynamics 365 Live' : 'Simulation Mode',
    };

    // If live credentials are provided, call Microsoft Dataverse Web API
    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        };

        const dynamicsPayload = {
          subject: `AI Lead: ${leadRecord.name} - ${leadRecord.company}`,
          firstname: leadData.firstname || leadRecord.name.split(' ')[0] || 'Lead',
          lastname: leadData.lastname || leadRecord.name.split(' ').slice(1).join(' ') || 'Customer',
          emailaddress1: leadRecord.email,
          mobilephone: leadRecord.phone,
          companyname: leadRecord.company,
          description: `Captured via Sales AI Agent at ${timestamp}\n\nClient Requirement:\n${leadRecord.requirement}`,
        };

        const res = await axios.post(`${this.crmUrl}/api/data/v9.2/leads`, dynamicsPayload, { headers });
        console.log('🎉 Successfully created lead in Dynamics 365!', res.status);
        leadRecord.dynamicsStatus = 'Live Synced (HTTP ' + res.status + ')';
      } catch (err) {
        console.error('❌ Error saving lead to Dynamics 365:', err.response ? err.response.data : err.message);
        leadRecord.dynamicsStatus = 'API Error: ' + (err.response?.data?.error?.message || err.message);
      }
    } else {
      console.log('ℹ️ [SIMULATION] Lead captured and logged:', leadRecord);
      leadRecord.dynamicsStatus = 'Simulated Success (Ready for live keys)';
    }

    capturedLeadsHistory.unshift(leadRecord);
    return leadRecord;
  }

  /**
   * Search for a lead or company conversation history in Dynamics 365
   */
  async searchLead(query, options = {}) {
    console.log(`🔍 Searching Dynamics 365 for: "${query}"`);

    // Check in-memory history first
    const localMatch = capturedLeadsHistory.find(
      (l) =>
        (l.company && l.company.toLowerCase().includes(query.toLowerCase())) ||
        (l.name && l.name.toLowerCase().includes(query.toLowerCase())) ||
        (l.email && l.email.toLowerCase().includes(query.toLowerCase()))
    );

    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        };

        const filter = `contains(companyname,'${encodeURIComponent(query)}') or contains(fullname,'${encodeURIComponent(query)}') or contains(subject,'${encodeURIComponent(query)}')`;
        const endpoint = `${this.crmUrl}/api/data/v9.2/leads?$filter=${filter}&$select=leadid,fullname,companyname,emailaddress1,mobilephone,telephone1,websiteurl,jobtitle,description,createdon,subject&$orderby=createdon desc&$top=1`;

        const res = await axios.get(endpoint, { headers });
        let lead = null;
        if (res.data && res.data.value && res.data.value.length > 0) {
          lead = res.data.value[0];
        } else {
          // Smart Spaceless & Subsequence Match Fallback (e.g. "ankitshah" matches "Ankit shah", "rinapatel" matches "Rina Patel")
          try {
            const allEndpoint = `${this.crmUrl}/api/data/v9.2/leads?$select=leadid,fullname,companyname,emailaddress1,mobilephone,telephone1,websiteurl,jobtitle,description,createdon,subject&$orderby=createdon desc&$top=50`;
            const allRes = await axios.get(allEndpoint, { headers });
            const allLeads = allRes.data?.value || [];
            const cleanQ = query.toLowerCase().replace(/[\s\-_.]/g, '');
            if (cleanQ.length >= 3) {
              lead = allLeads.find(l => {
                const fn = (l.fullname || '').toLowerCase().replace(/[\s\-_.]/g, '');
                const cn = (l.companyname || '').toLowerCase().replace(/[\s\-_.]/g, '');
                const em = (l.emailaddress1 || '').toLowerCase().replace(/[\s\-_.]/g, '');
                const sub = (l.subject || '').toLowerCase().replace(/[\s\-_.]/g, '');
                return (
                  fn.includes(cleanQ) || cleanQ.includes(fn) ||
                  cn.includes(cleanQ) || cleanQ.includes(cn) ||
                  em.includes(cleanQ) ||
                  sub.includes(cleanQ)
                );
              });
            }
          } catch (fallbackErr) {
            // Ignore fallback error
          }
        }

        if (lead) {
          let timelineNotes = '';
          if (lead.leadid && options.includeTimelineNotes) {
            try {
              const notesEndpoint = `${this.crmUrl}/api/data/v9.2/annotations?$filter=_objectid_value eq ${lead.leadid}&$select=subject,notetext,modifiedon&$orderby=modifiedon desc&$top=5`;
              const notesRes = await axios.get(notesEndpoint, { headers });
              if (notesRes.data && notesRes.data.value && notesRes.data.value.length > 0) {
                const cleanNotes = notesRes.data.value.map(n => {
                  const cleanText = (n.notetext || '').replace(/<!--SYNC_DATA:.*?-->/gs, '').trim();
                  return cleanText ? `[${n.subject || 'Note'}]: ${cleanText.slice(-600)}` : '';
                }).filter(Boolean);
                timelineNotes = cleanNotes.join(' | ');
              }
            } catch (noteErr) {
              // ignore timeline note fetch error
            }
          }
          return {
            found: true,
            leadId: lead.leadid,
            name: lead.fullname,
            company: lead.companyname,
            email: lead.emailaddress1,
            phone: lead.mobilephone || lead.telephone1,
            website: lead.websiteurl,
            jobTitle: lead.jobtitle,
            subject: lead.subject,
            description: lead.description,
            timelineNotes,
            createdOn: lead.createdon,
            source: 'Dynamics 365 Live CRM',
          };
        }
      } catch (err) {
        console.error('Error querying Dynamics 365:', err.response?.data || err.message);
      }
    }

    if (localMatch) {
      return {
        found: true,
        name: localMatch.name,
        company: localMatch.company,
        email: localMatch.email,
        phone: localMatch.phone,
        description: localMatch.requirement,
        createdOn: localMatch.createdAt,
        source: 'Dynamics 365 Cache',
      };
    }

    return { found: false, query };
  }

  /**
   * Find a lead by name/email for deletion — returns leadid (GUID) from Dynamics 365
   */
  async findLeadForDelete(query) {
    console.log(`🔍 Finding lead for deletion: "${query}"`);

    if (!this.isConfigured) {
      return { found: false, reason: 'Dynamics 365 not configured' };
    }

    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
      };

      const filter = `contains(fullname,'${encodeURIComponent(query)}') or contains(companyname,'${encodeURIComponent(query)}')`;
      const endpoint = `${this.crmUrl}/api/data/v9.2/leads?$filter=${filter}&$select=leadid,fullname,companyname,emailaddress1,mobilephone,createdon,subject&$orderby=createdon desc&$top=5`;

      const res = await axios.get(endpoint, { headers });

      let matchedLeads = (res.data && res.data.value) ? res.data.value : [];

      if (matchedLeads.length === 0) {
        // Fallback for spaceless or slight mismatch names (e.g. "ankitshah" -> "Ankit shah")
        try {
          const allEndpoint = `${this.crmUrl}/api/data/v9.2/leads?$select=leadid,fullname,companyname,emailaddress1,mobilephone,createdon,subject&$orderby=createdon desc&$top=50`;
          const allRes = await axios.get(allEndpoint, { headers });
          const allLeads = allRes.data?.value || [];
          const cleanQ = query.toLowerCase().replace(/[\s\-_.]/g, '');
          if (cleanQ.length >= 3) {
            matchedLeads = allLeads.filter(l => {
              const fn = (l.fullname || '').toLowerCase().replace(/[\s\-_.]/g, '');
              const cn = (l.companyname || '').toLowerCase().replace(/[\s\-_.]/g, '');
              const em = (l.emailaddress1 || '').toLowerCase().replace(/[\s\-_.]/g, '');
              return (fn && fn.includes(cleanQ)) || (cn && cn.includes(cleanQ)) || (em && em.includes(cleanQ));
            });
          }
        } catch (e) {
          // ignore fallback err
        }
      }

      if (matchedLeads.length > 0) {
        return {
          found: true,
          leads: matchedLeads.map((l) => ({
            leadid: l.leadid,
            fullname: l.fullname || 'Unknown',
            company: l.companyname || 'N/A',
            email: l.emailaddress1 || 'N/A',
            phone: l.mobilephone || 'N/A',
            createdOn: l.createdon,
            subject: l.subject || '',
          })),
        };
      }

      return { found: false, query };
    } catch (err) {
      console.error('❌ Error finding lead for delete:', err.response?.data || err.message);
      return { found: false, error: err.message };
    }
  }

  /**
   * Fetch a single lead by GUID (ID)
   */
  async getLeadById(leadId) {
    if (!this.isConfigured || !leadId) return null;
    const cleanId = leadId.replace(/[{}]/g, '');
    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
      };
      const res = await axios.get(`${this.crmUrl}/api/data/v9.2/leads(${cleanId})?$select=leadid,fullname,companyname,emailaddress1,mobilephone`, { headers });
      if (res.data) {
        return {
          leadid: res.data.leadid,
          fullname: res.data.fullname || 'Unknown',
          company: res.data.companyname || 'N/A',
          email: res.data.emailaddress1 || 'N/A',
          phone: res.data.mobilephone || 'N/A',
        };
      }
    } catch (err) {
      console.error('❌ Error fetching lead by ID:', err.response?.data || err.message);
    }
    return null;
  }

  /**
   * Permanently delete a lead from Dynamics 365 by leadid (GUID)
   */
  async deleteLead(leadId, leadName) {
    console.log(`🗑️ Deleting lead from Dynamics 365: ${leadName} (${leadId})`);

    if (!this.isConfigured) {
      return { success: false, reason: 'Dynamics 365 not configured' };
    }

    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
      };

      await axios.delete(`${this.crmUrl}/api/data/v9.2/leads(${leadId})`, { headers });
      console.log(`✅ Lead deleted successfully: ${leadName}`);

      // Also remove from local cache if present
      const idx = capturedLeadsHistory.findIndex((l) => l.name === leadName);
      if (idx !== -1) capturedLeadsHistory.splice(idx, 1);

      return { success: true, leadId, leadName };
    } catch (err) {
      console.error('❌ Error deleting lead from Dynamics 365:', err.response?.data || err.message);
      return {
        success: false,
        error: err.response?.data?.error?.message || err.message,
      };
    }
  }

  /**
   * Update lead fields in Dynamics 365 (e.g. phone, email, company, notes)
   */
  async updateLead(leadId, leadName, updateFields) {
    console.log(`✏️ Updating lead in Dynamics 365: ${leadName} (${leadId})`, updateFields);

    if (!this.isConfigured) {
      return { success: false, reason: 'Dynamics 365 not configured' };
    }

    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      };

      const payload = {};
      if (updateFields.phone || updateFields.mobilephone) {
        const ph = updateFields.phone || updateFields.mobilephone;
        payload.mobilephone = ph;
        payload.telephone1 = ph;
      }
      if (updateFields.email || updateFields.emailaddress1) {
        payload.emailaddress1 = updateFields.email || updateFields.emailaddress1;
      }
      if (updateFields.company || updateFields.companyname) {
        const newComp = updateFields.company || updateFields.companyname;
        payload.companyname = newComp;
        // Keep Dynamics 365 Topic (subject) synchronized with the updated company
        payload.subject = `AI Lead: ${leadName || 'Lead'} - ${newComp}`;
      }
      if (updateFields.website || updateFields.websiteurl) {
        let web = updateFields.website || updateFields.websiteurl;
        if (web && !web.startsWith('http://') && !web.startsWith('https://')) {
          web = 'https://' + web;
        }
        payload.websiteurl = web;
      }
      if (updateFields.jobtitle || updateFields.jobTitle || updateFields.title) {
        payload.jobtitle = updateFields.jobtitle || updateFields.jobTitle || updateFields.title;
      }
      if (updateFields.notes || updateFields.description) {
        payload.description = updateFields.notes || updateFields.description;
      }

      console.log(`📤 Sending PATCH payload to Dynamics 365 for ${leadName}:`, payload);
      await axios.patch(`${this.crmUrl}/api/data/v9.2/leads(${leadId})`, payload, { headers });
      console.log(`✅ Lead updated successfully in Dynamics 365: ${leadName}`, payload);

      // Update local history cache if present
      const local = capturedLeadsHistory.find(
        (l) => l.name?.toLowerCase() === leadName?.toLowerCase() || l.id === leadId
      );
      if (local) {
        if (payload.mobilephone) local.phone = payload.mobilephone;
        if (payload.emailaddress1) local.email = payload.emailaddress1;
        if (payload.companyname) local.company = payload.companyname;
      }

      return { success: true, leadId, leadName, updatedFields: payload };
    } catch (err) {
      console.error('❌ Error updating lead in Dynamics 365:', err.response?.data || err.message);
      return {
        success: false,
        error: err.response?.data?.error?.message || err.message,
      };
    }
  }

  /**
   * Convert (Qualify) a Lead into an Opportunity in Dynamics 365
   */
  async qualifyLead(leadId, leadName) {
    console.log(`🚀 Converting lead to Opportunity: ${leadName} (${leadId})`);

    if (!this.isConfigured) {
      return { success: false, reason: 'Dynamics 365 not configured' };
    }

    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      };

      // Check current state first
      try {
        const leadCheck = await axios.get(
          `${this.crmUrl}/api/data/v9.2/leads(${leadId})?$select=fullname,statecode,statuscode`,
          { headers }
        );
        if (leadCheck.data && leadCheck.data.statecode === 1) {
          console.log(`ℹ️ Lead ${leadName} is ALREADY Qualified in Dynamics 365.`);
          return {
            success: true,
            alreadyQualified: true,
            leadId,
            leadName,
          };
        }
      } catch (checkErr) { }

      const payload = {
        CreateOpportunity: true,
        CreateContact: true,
        CreateAccount: false,
        Status: 3, // 3 = Qualified
      };

      const res = await axios.post(
        `${this.crmUrl}/api/data/v9.2/leads(${leadId})/Microsoft.Dynamics.CRM.QualifyLead`,
        payload,
        { headers }
      );

      // Extract created Opportunity ID from response
      const opportunityRef = res.data?.CreatedEntities?.find(e =>
        e['@odata.type'] === '#Microsoft.Dynamics.CRM.opportunity'
      );
      const opportunityId = opportunityRef?.opportunityid || 'Created';

      console.log(`✅ Lead qualified! Opportunity ID: ${opportunityId}`);
      return { success: true, leadId, leadName, opportunityId };

    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      if (errMsg && errMsg.includes("Active stage is not on 'lead' entity")) {
        console.log(`ℹ️ Lead ${leadName} is already qualified into an Opportunity.`);
        return {
          success: true,
          alreadyQualified: true,
          leadId,
          leadName,
        };
      }
      console.error('❌ Error qualifying lead:', err.response?.data || err.message);
      return {
        success: false,
        error: errMsg,
      };
    }
  }

  getLeadsHistory() {
    return capturedLeadsHistory;
  }

  /**
   * Fetch ALL leads from Dynamics 365 CRM (live count + list)
   */
  async getAllLeads(top = 15) {
    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
        };

        const endpoint = `${this.crmUrl}/api/data/v9.2/leads?$select=fullname,companyname,emailaddress1,mobilephone,createdon,subject,statuscode,statecode&$orderby=createdon desc&$top=${top}`;
        const countEndpoint = `${this.crmUrl}/api/data/v9.2/leads?$count=true&$select=fullname&$top=1`;
        const qualCountEndpoint = `${this.crmUrl}/api/data/v9.2/leads?$count=true&$filter=statecode eq 1&$top=1`;
        const openCountEndpoint = `${this.crmUrl}/api/data/v9.2/leads?$count=true&$filter=statecode eq 0&$top=1`;

        // Fetch count, qualified count, open count, and leads in parallel
        const [leadsRes, countRes, qualRes, openRes] = await Promise.all([
          axios.get(endpoint, { headers }),
          axios.get(countEndpoint, { headers }),
          axios.get(qualCountEndpoint, { headers }).catch(() => ({ data: {} })),
          axios.get(openCountEndpoint, { headers }).catch(() => ({ data: {} })),
        ]);

        const leads = leadsRes.data.value || [];
        const totalCount = countRes.data['@odata.count'] || leads.length;
        const qualifiedCount = qualRes.data?.['@odata.count'] !== undefined ? qualRes.data['@odata.count'] : leads.filter(l => l.statecode === 1).length;
        const openCount = openRes.data?.['@odata.count'] !== undefined ? openRes.data['@odata.count'] : leads.filter(l => l.statecode === 0).length;

        return {
          source: 'Dynamics 365 Live',
          totalCount,
          qualifiedCount,
          openCount,
          leads: leads.map((l) => ({
            fullname: l.fullname || 'Unknown',
            company: l.companyname || 'N/A',
            email: l.emailaddress1 || 'N/A',
            phone: l.mobilephone || 'N/A',
            createdOn: l.createdon,
            subject: l.subject || '',
            status: l.statecode === 1 ? 'Qualified' : (l.statecode === 2 ? 'Disqualified' : 'New / Open'),
          })),
        };
      } catch (err) {
        console.error('❌ Error fetching all leads from Dynamics 365:', err.response?.data || err.message);
        // Fall through to local cache
      }
    }

    // Fallback: in-memory session leads
    return {
      source: 'Local Session Cache',
      totalCount: capturedLeadsHistory.length,
      leads: capturedLeadsHistory.map((l) => ({
        fullname: l.name || 'Unknown',
        company: l.company || 'N/A',
        email: l.email || 'N/A',
        phone: l.phone || 'N/A',
        createdOn: l.createdAt,
      })),
    };
  }

  /**
   * Robust Date Parser for Natural Language Dates (e.g. "tomorrow 5 PM", "tomorrow at 11am")
   */
  parseFlexibleDate(dateInput, defaultHour = 17, defaultMinute = 0) {
    if (!dateInput) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(defaultHour, defaultMinute, 0, 0);
      return d.toISOString();
    }

    const directDate = new Date(dateInput);
    if (!isNaN(directDate.getTime())) {
      return directDate.toISOString();
    }

    const lower = String(dateInput).toLowerCase().trim();
    const target = new Date();

    if (lower.includes('day after tomorrow')) {
      target.setDate(target.getDate() + 2);
    } else if (lower.includes('tomorrow')) {
      target.setDate(target.getDate() + 1);
    } else if (lower.includes('next week')) {
      target.setDate(target.getDate() + 7);
    }

    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : '';
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      target.setHours(hours, minutes, 0, 0);
    } else {
      target.setHours(defaultHour, defaultMinute, 0, 0);
    }

    return target.toISOString();
  }

  /**
   * Schedule an Appointment in Dynamics 365 regarding a Lead
   */
  async createAppointment({ leadId, leadName, subject, startTime, endTime, durationMinutes = 30, description }) {
    console.log(`📅 Scheduling appointment in Dynamics 365 for ${leadName || 'Lead'}: "${subject}"`);

    let cleanDesc = description;
    if (!cleanDesc || cleanDesc.trim().toLowerCase() === (subject || '').trim().toLowerCase()) {
      cleanDesc = `Scheduled via Sales AI Copilot for ${leadName || 'Prospect'}. Agenda: Product walkthrough & technical discussion.`;
    }

    const startIso = this.parseFlexibleDate(startTime, 11, 0);
    const endIso = endTime ? this.parseFlexibleDate(endTime, 11, 30) : new Date(new Date(startIso).getTime() + durationMinutes * 60000).toISOString();

    const appointmentRecord = {
      subject: subject || `Sales Discussion with ${leadName || 'Client'}`,
      description: cleanDesc,
      scheduledstart: startIso,
      scheduledend: endIso,
      scheduleddurationminutes: durationMinutes,
    };

    if (leadId) {
      const cleanLeadId = String(leadId).replace(/[{}]/g, '');
      appointmentRecord['regardingobjectid_lead@odata.bind'] = `/leads(${cleanLeadId})`;
    }

    const apptOwnerId = String(process.env.DYNAMICS_DEFAULT_USER_ID || '3a5c5ea2-c48d-f111-8077-e4fb1efed92c').replace(/[{}]/g, '');
    if (apptOwnerId) {
      appointmentRecord['ownerid@odata.bind'] = `/systemusers(${apptOwnerId})`;
    }

    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        };

        const res = await axios.post(`${this.crmUrl}/api/data/v9.2/appointments`, appointmentRecord, { headers });
        console.log('🎉 Successfully created appointment in Dynamics 365!', res.status);

        const entityIdHeader = res.headers['odata-entityid'] || '';
        const match = entityIdHeader.match(/appointments\(([^)]+)\)/);
        const appointmentId = match ? match[1] : 'APPT-' + Date.now().toString().slice(-6);

        return {
          success: true,
          appointmentId,
          subject: appointmentRecord.subject,
          startTime: appointmentRecord.scheduledstart,
          endTime: appointmentRecord.scheduledend,
          duration: appointmentRecord.scheduleddurationminutes,
          leadName,
          leadId,
        };
      } catch (err) {
        console.error('❌ Error creating appointment in Dynamics 365:', err.response?.data || err.message);
        return {
          success: false,
          error: err.response?.data?.error?.message || err.message,
        };
      }
    }

    return {
      success: true,
      appointmentId: 'APPT-SIM-' + Date.now().toString().slice(-6),
      subject: appointmentRecord.subject,
      startTime: appointmentRecord.scheduledstart,
      endTime: appointmentRecord.scheduledend,
      duration: durationMinutes,
      leadName,
      leadId,
      simulated: true,
    };
  }

  async scheduleAppointment(params) {
    return this.createAppointment(params);
  }

  /**
   * Create a Task in Microsoft Dynamics 365 regarding a Lead
   */
  async createTask({ leadId, leadName, subject, dueDate, description, priority = 1, ownerUserId }) {
    console.log(`📝 Creating Task in Dynamics 365 for ${leadName || 'Lead'}: "${subject}"`);

    let cleanDesc = description;
    if (!cleanDesc) {
      cleanDesc = `🤖 Task created via Sales AI Copilot for ${leadName || 'Client'}.`;
    } else if (!cleanDesc.includes('Sales AI Copilot')) {
      cleanDesc = `🤖 [Sales AI Copilot] ${cleanDesc}`;
    }

    const dueIso = this.parseFlexibleDate(dueDate, 17, 0);

    const taskRecord = {
      subject: subject || `Follow-up with ${leadName || 'Client'}`,
      description: cleanDesc,
      scheduledend: dueIso,
      prioritycode: priority, // 0 = Low, 1 = Normal, 2 = High
    };

    if (leadId) {
      const cleanId = String(leadId).replace(/[{}]/g, '');
      taskRecord['regardingobjectid_lead@odata.bind'] = `/leads(${cleanId})`;
    }

    const targetOwnerId = String(ownerUserId || process.env.DYNAMICS_DEFAULT_USER_ID || '3a5c5ea2-c48d-f111-8077-e4fb1efed92c').replace(/[{}]/g, '');
    if (targetOwnerId) {
      taskRecord['ownerid@odata.bind'] = `/systemusers(${targetOwnerId})`;
    }

    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        };

        const res = await axios.post(`${this.crmUrl}/api/data/v9.2/tasks`, taskRecord, { headers });
        const entityIdUrl = res.headers['odata-entityid'] || '';
        const taskId = entityIdUrl ? entityIdUrl.split(/[()]/)[1] : 'Saved';
        console.log('🎉 Successfully created Task in Dynamics 365!', taskId);

        return {
          success: true,
          taskId,
          subject: taskRecord.subject,
          dueDate: taskRecord.scheduledend,
          description: taskRecord.description,
          priority: priority === 2 ? 'High' : (priority === 0 ? 'Low' : 'Normal'),
          leadName,
          leadId,
        };
      } catch (err) {
        console.error('❌ Error creating task in Dynamics 365:', err.response?.data || err.message);
        return {
          success: false,
          error: err.response?.data?.error?.message || err.message,
        };
      }
    }

    return {
      success: true,
      taskId: 'TASK-SIM-' + Date.now().toString().slice(-6),
      subject: taskRecord.subject,
      dueDate: taskRecord.scheduledend,
      description: taskRecord.description,
      priority: 'Normal',
      leadName,
      leadId,
      simulated: true,
    };
  }

  /**
   * Fetch scheduled tasks from Microsoft Dynamics 365
   */
  async getTasks({ leadId, query, top = 10 } = {}) {
    console.log(`📋 Querying tasks from Dynamics 365...`);
    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
        };

        let filterParts = [];
        if (leadId) {
          const cleanId = leadId.replace(/[{}]/g, '');
          filterParts.push(`_regardingobjectid_value eq ${cleanId}`);
        }

        const filterQuery = filterParts.length ? `$filter=${filterParts.join(' and ')}&` : '';
        const endpoint = `${this.crmUrl}/api/data/v9.2/tasks?${filterQuery}$select=subject,description,scheduledend,prioritycode,statecode,statuscode&$orderby=scheduledend desc&$top=${top}`;

        const res = await axios.get(endpoint, { headers });
        const items = res.data.value || [];
        return {
          success: true,
          found: items.length > 0,
          total: items.length,
          tasks: items.map(t => ({
            subject: t.subject,
            description: t.description,
            dueDate: t.scheduledend,
            priority: t.prioritycode === 2 ? 'High' : (t.prioritycode === 0 ? 'Low' : 'Normal'),
            status: t.statecode === 0 ? 'Open / In Progress' : 'Completed',
          })),
        };
      } catch (err) {
        console.error('❌ Error fetching tasks from Dynamics 365:', err.response?.data || err.message);
      }
    }

    return {
      success: true,
      found: false,
      total: 0,
      tasks: [],
    };
  }

  /**
   * Fetch scheduled appointments / demo meetings from Dynamics 365
   */
  async getAppointments({ leadId, query, top = 10 } = {}) {
    console.log(`📅 Querying scheduled appointments from Dynamics 365...`);
    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
        };

        let filterParts = [];
        if (leadId) {
          const cleanId = leadId.replace(/[{}]/g, '');
          filterParts.push(`_regardingobjectid_value eq ${cleanId}`);
        }

        const filterQuery = filterParts.length ? `$filter=${filterParts.join(' and ')}&` : '';
        const endpoint = `${this.crmUrl}/api/data/v9.2/appointments?${filterQuery}$select=subject,description,scheduledstart,scheduledend,scheduleddurationminutes,statecode&$orderby=scheduledstart desc&$top=${top}`;

        const res = await axios.get(endpoint, { headers });
        const items = res.data.value || [];
        return {
          success: true,
          found: items.length > 0,
          total: items.length,
          appointments: items.map(a => ({
            subject: a.subject,
            description: a.description,
            start: a.scheduledstart,
            end: a.scheduledend,
            duration: a.scheduleddurationminutes,
            status: a.statecode === 0 ? 'Scheduled / Open' : (a.statecode === 1 ? 'Completed' : 'Canceled'),
          })),
        };
      } catch (err) {
        console.error('❌ Error fetching appointments from Dynamics 365:', err.response?.data || err.message);
      }
    }

    return {
      success: true,
      found: false,
      total: 0,
      appointments: [],
    };
  }

  /**
   * Save or update Chat Transcript in Dynamics 365 Notes (annotations) for a Lead
   */
  async saveChatTranscript(leadId, messages) {
    if (!this.isConfigured || !leadId || !messages || !messages.length) {
      return { success: false, reason: 'Invalid parameters or Dynamics 365 not configured' };
    }

    const cleanId = leadId.replace(/[{}]/g, '');
    console.log(`📝 Saving chat transcript to Dynamics 365 for Lead (${cleanId})...`);

    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
      };

      const filter = `_objectid_value eq ${cleanId} and contains(subject,'Sales Copilot Chat')`;
      const searchEndpoint = `${this.crmUrl}/api/data/v9.2/annotations?$filter=${filter}&$select=annotationid,subject,notetext,createdon&$orderby=createdon desc&$top=1`;

      const searchRes = await axios.get(searchEndpoint, { headers });
      const existing = (searchRes.data && searchRes.data.value && searchRes.data.value.length > 0) ? searchRes.data.value[0] : null;

      const humanLines = messages.map(m => {
        const who = m.sender === 'user' ? '👤 [Sales Rep]' : '🤖 [AI Copilot]';
        return `${who}:\n${m.text}`;
      }).join('\n\n──────────────────────────────────────\n\n');

      const jsonPayload = JSON.stringify({ messages: messages.slice(-50) });
      const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
      const notePayloadText = `💬 Sales Copilot Chat History\n🕒 Last Synced: ${nowStr}\n══════════════════════════════════════\n\n${humanLines}\n\n<!--SYNC_DATA:${jsonPayload}-->`;

      let finalNoteText = notePayloadText;
      if (finalNoteText.length > 80000) {
        finalNoteText = notePayloadText.slice(0, 300) + '\n...[older messages truncated]...\n' + notePayloadText.slice(-75000);
      }

      if (existing) {
        await axios.patch(`${this.crmUrl}/api/data/v9.2/annotations(${existing.annotationid})`, {
          notetext: finalNoteText,
          subject: 'Sales Copilot Chat Transcript (Live Synced)',
        }, { headers });
        console.log('✅ Updated existing Chat Note in Dynamics 365 Timeline!');
        return { success: true, annotationId: existing.annotationid, action: 'updated' };
      } else {
        const createPayload = {
          subject: 'Sales Copilot Chat Transcript (Live Synced)',
          notetext: finalNoteText,
          'objectid_lead@odata.bind': `/leads(${cleanId})`,
        };
        const res = await axios.post(`${this.crmUrl}/api/data/v9.2/annotations`, createPayload, { headers });
        console.log('🎉 Created new Chat Note in Dynamics 365 Timeline!', res.status);
        return { success: true, action: 'created' };
      }
    } catch (err) {
      console.error('❌ Error saving chat transcript to Dynamics 365:', err.response?.data || err.message);
      return { success: false, error: err.response?.data?.error?.message || err.message };
    }
  }

  /**
   * Fetch Chat Transcript from Dynamics 365 Notes (annotations) for a Lead
   */
  async getChatTranscript(leadId) {
    if (!this.isConfigured || !leadId) {
      return { success: false, messages: [] };
    }

    const cleanId = leadId.replace(/[{}]/g, '');
    console.log(`🔍 Fetching chat transcript from Dynamics 365 for Lead (${cleanId})...`);

    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Accept: 'application/json',
      };

      const filter = `_objectid_value eq ${cleanId} and contains(subject,'Sales Copilot Chat')`;
      const endpoint = `${this.crmUrl}/api/data/v9.2/annotations?$filter=${filter}&$select=annotationid,subject,notetext,createdon,modifiedon&$orderby=modifiedon desc&$top=1`;

      const res = await axios.get(endpoint, { headers });
      if (res.data && res.data.value && res.data.value.length > 0) {
        const note = res.data.value[0];
        const rawText = note.notetext || '';

        // 1. Check for embedded <!--SYNC_DATA:...-->
        const syncMatch = rawText.match(/<!--SYNC_DATA:(.*?)-->/s);
        if (syncMatch) {
          try {
            const parsed = JSON.parse(syncMatch[1]);
            return {
              success: true,
              found: true,
              annotationId: note.annotationid,
              messages: parsed.messages || [],
              lastUpdated: note.modifiedon || note.createdon,
            };
          } catch (e) { }
        }

        // 2. Legacy fallback: parse entire string as JSON if old format
        try {
          const parsed = JSON.parse(rawText);
          return {
            success: true,
            found: true,
            annotationId: note.annotationid,
            messages: parsed.messages || [],
            lastUpdated: note.modifiedon || note.createdon,
          };
        } catch (e) {
          return {
            success: true,
            found: true,
            messages: [{ sender: 'ai', text: rawText }],
          };
        }
      }

      return { success: true, found: false, messages: [] };
    } catch (err) {
      console.error('❌ Error fetching chat transcript from Dynamics 365:', err.response?.data || err.message);
      return { success: false, messages: [], error: err.message };
    }
  }

  /**
   * 📑 Fetch Quote details and products by ID
   */
  async getQuoteById(quoteId) {
    const cleanId = String(quoteId || '').replace(/[{}]/g, '');
    if (!cleanId) return null;

    if (!this.isConfigured) {
      return {
        quoteid: cleanId,
        quotenumber: 'QUO-1002-TEST',
        name: 'Enterprise AI Suite Quotation',
        totalamount: 32995,
        customerName: 'Valued Customer',
        company: 'Webtual Technology',
        email: 'customer@example.com',
        items: [
          { description: 'Starter AI Agent Suite - Annual Plan (5 Users)', qty: 5, unitPrice: 4999, total: 24995 },
          { description: 'Dynamics 365 Dataverse Integration & Setup', qty: 1, unitPrice: 8000, total: 8000 }
        ]
      };
    }

    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const res = await axios.get(
        `${this.crmUrl}/api/data/v9.2/quotes(${cleanId})?$select=quoteid,name,quotenumber,totalamount,totaldiscountamount,totaltax,statecode,statuscode,_customerid_value`,
        { headers }
      );
      const q = res.data;

      // Fetch quote products (quotedetails)
      let items = [];
      try {
        const linesRes = await axios.get(
          `${this.crmUrl}/api/data/v9.2/quotedetails?$filter=_quoteid_value eq ${cleanId}&$select=productdescription,quantity,priceperunit,extendedamount,tax`,
          { headers }
        );
        if (linesRes.data?.value?.length > 0) {
          items = linesRes.data.value.map(line => ({
            description: line.productdescription || 'Product / Service Item',
            qty: Number(line.quantity) || 1,
            unitPrice: Number(line.priceperunit) || 0,
            total: Number(line.extendedamount) || (Number(line.quantity) * Number(line.priceperunit)) || 0,
            tax: Number(line.tax) || 0
          }));
        }
      } catch (lineErr) {
        console.warn('Could not fetch quote products:', lineErr.message);
      }

      // Customer name lookup
      let customerName = 'Valued Customer';
      let customerEmail = 'customer@example.com';
      let company = 'Webtual Technology';

      if (q._customerid_value) {
        try {
          const contactRes = await axios.get(
            `${this.crmUrl}/api/data/v9.2/contacts(${q._customerid_value})?$select=fullname,emailaddress1,parentcustomerid_account`,
            { headers }
          );
          if (contactRes.data) {
            customerName = contactRes.data.fullname || customerName;
            customerEmail = contactRes.data.emailaddress1 || customerEmail;
          }
        } catch (e) {
          try {
            const accRes = await axios.get(
              `${this.crmUrl}/api/data/v9.2/accounts(${q._customerid_value})?$select=name,emailaddress1`,
              { headers }
            );
            if (accRes.data) {
              customerName = accRes.data.name || customerName;
              company = accRes.data.name || company;
              customerEmail = accRes.data.emailaddress1 || customerEmail;
            }
          } catch (e2) {}
        }
      }

      if (q.name && q.name.includes(' - ')) {
        const parts = q.name.split(' - ');
        if (parts.length > 1 && (customerName === 'Valued Customer' || customerName === 'Hi Customer')) {
          customerName = parts[parts.length - 1].trim();
        }
      }

      return {
        quoteid: q.quoteid,
        name: q.name,
        quotenumber: q.quotenumber || 'QUO-' + q.quoteid.slice(0, 6),
        totalamount: q.totalamount || 0,
        customerName,
        customerEmail,
        company,
        items: items.length > 0 ? items : [
          { description: q.name || 'Sales Quote Item', qty: 1, unitPrice: q.totalamount || 10000, total: q.totalamount || 10000 }
        ]
      };
    } catch (err) {
      console.error('Error fetching quote by ID:', err.response?.data || err.message);
      return null;
    }
  }

  /**
   * 🔍 Find a quotation by customer name, quote name, or quote number
   */
  async findQuoteByQuery(query = '') {
    if (!this.isConfigured) return null;
    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const res = await axios.get(`${this.crmUrl}/api/data/v9.2/quotes?$select=quoteid,name,quotenumber,totalamount&$orderby=createdon desc&$top=20`, { headers });
      const quotes = res.data?.value || [];
      if (!quotes.length) return null;

      if (!query || !query.trim()) {
        return await this.getQuoteById(quotes[0].quoteid);
      }

      const qNorm = query.toLowerCase().trim().replace(/[\s\-_.]/g, '');
      const found = quotes.find(q => {
        const qName = (q.name || '').toLowerCase().replace(/[\s\-_.]/g, '');
        const qNum = (q.quotenumber || '').toLowerCase().replace(/[\s\-_.]/g, '');
        return qName.includes(qNorm) || qNorm.includes(qName) || qNum.includes(qNorm);
      });

      if (found) {
        return await this.getQuoteById(found.quoteid);
      }
      return null;
    } catch (e) {
      console.warn('findQuoteByQuery error:', e.message);
      return null;
    }
  }

  /**
   * 📄 Fetch Invoice details and line items by ID
   */
  async getInvoiceById(invoiceId) {
    const cleanId = String(invoiceId || '').replace(/[{}]/g, '');
    if (!cleanId) return null;

    if (!this.isConfigured) {
      return {
        invoiceid: cleanId,
        invoicenumber: 'INV-01002-B2P4S4',
        name: 'Sales Invoice - Avani',
        totalamount: 29500,
        totaltax: 4500,
        status: 'Active',
        customerName: 'Bhargav mistri',
        company: 'Webtual Technology',
        email: 'bhargav@webtual.com',
        items: [
          { description: 'Starter AI Agent Suite - Annual Plan (5 Users)', qty: 5, unitPrice: 4999, total: 24995 },
          { description: 'Dynamics 365 Setup & Maintenance', qty: 1, unitPrice: 4505, total: 4505 }
        ]
      };
    }

    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const res = await axios.get(
        `${this.crmUrl}/api/data/v9.2/invoices(${cleanId})?$select=invoiceid,name,invoicenumber,totalamount,totaltax,totallineitemamount,totaldiscountamount,statecode,statuscode,duedate,description,_customerid_value`,
        { headers }
      );
      const inv = res.data;

      // Fetch invoice products (invoicedetails)
      let items = [];
      try {
        const linesRes = await axios.get(
          `${this.crmUrl}/api/data/v9.2/invoicedetails?$filter=_invoiceid_value eq ${cleanId}&$select=productdescription,quantity,priceperunit,extendedamount,tax`,
          { headers }
        );
        if (linesRes.data?.value?.length > 0) {
          items = linesRes.data.value.map(line => ({
            description: line.productdescription || 'Product / Service Item',
            qty: Number(line.quantity) || 1,
            unitPrice: Number(line.priceperunit) || 0,
            total: Number(line.extendedamount) || (Number(line.quantity) * Number(line.priceperunit)) || 0,
            tax: Number(line.tax) || 0
          }));
        }
      } catch (lineErr) {
        console.warn('Could not fetch invoice products:', lineErr.message);
      }

      // Customer lookup
      let customerName = 'Valued Customer';
      let customerEmail = 'customer@example.com';
      let company = 'Webtual Technology';

      if (inv._customerid_value) {
        try {
          const contactRes = await axios.get(
            `${this.crmUrl}/api/data/v9.2/contacts(${inv._customerid_value})?$select=fullname,emailaddress1`,
            { headers }
          );
          if (contactRes.data) {
            customerName = contactRes.data.fullname || customerName;
            customerEmail = contactRes.data.emailaddress1 || customerEmail;
          }
        } catch (e) {
          try {
            const accRes = await axios.get(
              `${this.crmUrl}/api/data/v9.2/accounts(${inv._customerid_value})?$select=name,emailaddress1`,
              { headers }
            );
            if (accRes.data) {
              customerName = accRes.data.name || customerName;
              company = accRes.data.name || company;
              customerEmail = accRes.data.emailaddress1 || customerEmail;
            }
          } catch (e2) {}
        }
      }

      if (inv.name && inv.name.startsWith('Sales Invoice - ')) {
        const parsedName = inv.name.replace('Sales Invoice - ', '').trim();
        if (parsedName && (customerName === 'Valued Customer' || customerName === 'Hi Customer')) {
          customerName = parsedName;
        }
      }

      return {
        invoiceid: inv.invoiceid,
        name: inv.name,
        invoicenumber: inv.invoicenumber || 'INV-' + inv.invoiceid.slice(0, 6),
        totalamount: inv.totalamount || 0,
        totaltax: inv.totaltax || 0,
        totallineitemamount: inv.totallineitemamount || 0,
        totaldiscountamount: inv.totaldiscountamount || 0,
        status: inv.statecode === 2 ? 'PAID' : (inv.statecode === 1 ? 'ACTIVE' : 'DRAFT'),
        customerName,
        customerEmail,
        company,
        dueDate: inv.duedate ? new Date(inv.duedate).toLocaleDateString('en-GB') : null,
        description: inv.description,
        items: items.length > 0 ? items : [
          { description: inv.name || 'Sales Invoice Item', qty: 1, unitPrice: inv.totalamount || 10000, total: inv.totalamount || 10000 }
        ]
      };
    } catch (err) {
      console.error('Error fetching invoice by ID:', err.response?.data || err.message);
      return null;
    }
  }

  /**
   * 📄 Fetch Invoice details and line items by Invoice Number (e.g. INV-01023-T2D4C1)
   */
  async getInvoiceByNumber(invoiceNumber) {
    if (!invoiceNumber) return null;
    if (!this.isConfigured) return null;

    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const res = await axios.get(
        `${this.crmUrl}/api/data/v9.2/invoices?$filter=invoicenumber eq '${encodeURIComponent(invoiceNumber)}'&$select=invoiceid,name,invoicenumber,totalamount,totaltax,totallineitemamount,totaldiscountamount,statecode,statuscode,duedate,description,_customerid_value&$top=1`,
        { headers }
      );
      if (res.data?.value?.length > 0) {
        return await this.getInvoiceById(res.data.value[0].invoiceid);
      }
      return null;
    } catch (err) {
      console.error('Error fetching invoice by number from Dynamics 365:', err.response?.data || err.message);
      return null;
    }
  }

  /**
   * ⚡ Fetch the most recent live invoice from Dynamics 365 Dataverse
   */
  async getLatestInvoice() {
    if (!this.isConfigured) return null;
    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const res = await axios.get(
        `${this.crmUrl}/api/data/v9.2/invoices?$orderby=createdon desc&$select=invoiceid&$top=1`,
        { headers }
      );
      if (res.data?.value?.length > 0) {
        return await this.getInvoiceById(res.data.value[0].invoiceid);
      }
      return null;
    } catch (e) {
      console.warn('Could not fetch latest invoice from Dataverse:', e.message);
      return null;
    }
  }

  /**
   * ⚡ Convert Quote to an official Tax Invoice in Dynamics 365
   */
  async convertQuoteToInvoice(quoteId, customData = {}) {
    let cleanId = String(quoteId || '').replace(/[{}]/g, '').trim();
    if (cleanId === 'null' || cleanId === 'undefined') cleanId = '';

    let quote = null;
    if (cleanId) {
      quote = await this.getQuoteById(cleanId);
    }

    if (!quote && this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
        const qRes = await axios.get(
          `${this.crmUrl}/api/data/v9.2/quotes?$orderby=modifiedon desc&$top=1`,
          { headers }
        );
        if (qRes.data?.value?.length > 0) {
          const foundId = qRes.data.value[0].quoteid;
          quote = await this.getQuoteById(foundId);
          console.log(`🔍 Auto-resolved active quote in Dynamics 365: #${quote?.quotenumber} (${foundId})`);
        }
      } catch (err) {
        console.warn('Fallback quote lookup error:', err.message);
      }
    }

    if (!quote) throw new Error(`Quotation with ID "${quoteId || 'active'}" not found in Dynamics 365.`);

    const customerName = customData.customerName || quote.customerName || 'Valued Customer';
    const company = customData.company || quote.company || 'Webtual Technology';
    const email = customData.email || quote.customerEmail || 'customer@example.com';
    const items = quote.items && quote.items.length > 0 ? quote.items : [
      { description: quote.name || 'Enterprise Service Plan', qty: 1, unitPrice: quote.totalamount || 25000, total: quote.totalamount || 25000 }
    ];

    const subtotal = items.reduce((acc, it) => acc + (it.total || it.qty * it.unitPrice), 0);
    const discountPercent = customData.discountPercent !== undefined ? customData.discountPercent : 10;
    const discountAmount = Math.round((subtotal * discountPercent) / 100);
    const taxable = subtotal - discountAmount;
    const taxAmount = Math.round((taxable * 18) / 100);
    const grandTotal = taxable + taxAmount;
    const invoiceNumber = 'INV-' + Date.now().toString().slice(-6);

    const result = {
      success: true,
      invoiceId: null,
      invoiceNumber,
      customerName,
      company,
      email,
      items,
      subtotal,
      discountPercent,
      discountAmount,
      taxAmount,
      grandTotal,
      convertedFromQuoteId: cleanId,
      quoteNumber: quote.quotenumber,
    };

    if (this.isConfigured) {
      try {
        const token = await this.getAccessToken();
        const headers = {
          Authorization: `Bearer ${token}`,
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
          Prefer: 'return=representation'
        };

        // Try to bind contact / account
        let customerBinding = null;
        try {
          if (email && email !== 'customer@example.com') {
            const cRes = await axios.get(`${this.crmUrl}/api/data/v9.2/contacts?$filter=emailaddress1 eq '${encodeURIComponent(email)}'&$select=contactid&$top=1`, { headers });
            if (cRes.data.value?.length > 0) customerBinding = { 'customerid_contact@odata.bind': `/contacts(${cRes.data.value[0].contactid})` };
          }
          if (!customerBinding && customerName && customerName !== 'Valued Customer') {
            const nRes = await axios.get(`${this.crmUrl}/api/data/v9.2/contacts?$filter=contains(fullname,'${encodeURIComponent(customerName)}')&$select=contactid&$top=1`, { headers });
            if (nRes.data.value?.length > 0) customerBinding = { 'customerid_contact@odata.bind': `/contacts(${nRes.data.value[0].contactid})` };
          }
        } catch (e) {}

        const dynamicsPayload = {
          name: `Sales Invoice - ${customerName}`,
          description: `Automatically converted from Quote #${quote.quotenumber} via Sales AI Copilot`,
          discountpercentage: discountPercent,
          duedate: customData.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
          ...(customerBinding || {})
        };

        const createRes = await axios.post(`${this.crmUrl}/api/data/v9.2/invoices`, dynamicsPayload, { headers });
        let invoiceId = createRes.data?.invoiceid;
        if (!invoiceId && createRes.headers['odata-entityid']) {
          const m = createRes.headers['odata-entityid'].match(/invoices\(([0-9a-fA-F-]+)\)/);
          if (m) invoiceId = m[1];
        }

        result.invoiceId = invoiceId;
        result.invoiceNumber = createRes.data?.invoicenumber || invoiceNumber;

        // Line items
        if (invoiceId && items.length > 0) {
          for (const item of items) {
            try {
              await axios.post(`${this.crmUrl}/api/data/v9.2/invoicedetails`, {
                'invoiceid@odata.bind': `/invoices(${invoiceId})`,
                isproductoverridden: true,
                productdescription: item.description,
                priceperunit: Number(item.unitPrice) || 0,
                quantity: Number(item.qty) || 1,
                tax: Number(item.tax) || 0
              }, { headers });
            } catch (le) {
              console.warn('Line item creation notice:', le.message);
            }
          }

          // Patch totals
          try {
            await axios.patch(`${this.crmUrl}/api/data/v9.2/invoices(${invoiceId})`, {
              totallineitemamount: subtotal,
              totaltax: taxAmount,
              totaldiscountamount: discountAmount,
              totalamount: grandTotal
            }, { headers });
          } catch (pe) {}
        }

        console.log(`🎉 Successfully converted Quote #${quote.quotenumber} to Invoice #${result.invoiceNumber} in Dynamics 365!`);
        return result;
      } catch (err) {
        console.error('Error creating invoice from quote in Dynamics 365:', err.response?.data || err.message);
        result.error = err.response?.data?.error?.message || err.message;
        return result;
      }
    }

    return result;
  }

  /**
   * ✅ Mark Invoice as Paid in Dynamics 365
   */
  async markInvoiceAsPaid(invoiceId, paymentNote = 'Payment confirmed via Bank Transfer') {
    const cleanId = String(invoiceId || '').replace(/[{}]/g, '');
    const timestamp = new Date().toLocaleString('en-US');

    if (!this.isConfigured) {
      return { success: true, status: 'Paid', invoiceId: cleanId, timestamp };
    }

    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' };

      // Attach confirmation note to invoice timeline
      try {
        await axios.post(`${this.crmUrl}/api/data/v9.2/annotations`, {
          subject: `✅ Payment Received & Invoice Settled`,
          notetext: `${paymentNote}\nTimestamp: ${timestamp}\nVerified by Dynamics 365 Invoice AI Copilot.`,
          'objectid_invoice@odata.bind': `/invoices(${cleanId})`
        }, { headers });
      } catch (e) {
        console.warn('Could not attach payment note:', e.message);
      }

      // Update statecode to Paid if allowed
      try {
        await axios.patch(`${this.crmUrl}/api/data/v9.2/invoices(${cleanId})`, {
          statuscode: 100001
        }, { headers });
      } catch (e) {}

      return { success: true, status: 'PAID', invoiceId: cleanId, timestamp };
    } catch (err) {
      console.error('Error marking invoice paid in Dynamics 365:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 📎 Attach PDF to Invoice Timeline in Dynamics 365
   */
  async attachInvoicePdf(invoiceId, pdfBuffer, fileName = 'Tax_Invoice.pdf') {
    const cleanId = String(invoiceId || '').replace(/[{}]/g, '');
    if (!this.isConfigured || !cleanId || !pdfBuffer) return false;

    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' };
      await axios.post(`${this.crmUrl}/api/data/v9.2/annotations`, {
        subject: `📄 Official Tax Invoice PDF - ${fileName}`,
        filename: fileName,
        mimetype: 'application/pdf',
        documentbody: pdfBuffer.toString('base64'),
        'objectid_invoice@odata.bind': `/invoices(${cleanId})`
      }, { headers });
      console.log('✅ Attached Invoice PDF to Dynamics 365 Timeline!');
      return true;
    } catch (err) {
      console.warn('Could not attach PDF note to invoice:', err.message);
      return false;
    }
  }

  /**
   * 🔍 Quick lookup across Quotes and Invoices
   */
  async searchQuotesAndInvoices(query = '') {
    if (!query) return { quotes: [], invoices: [] };
    const qStr = encodeURIComponent(query.trim());

    if (!this.isConfigured) {
      return {
        quotes: [{ quoteid: 'mock-q-1', quotenumber: 'QUO-1002', name: 'Enterprise AI Suite', totalamount: 32995 }],
        invoices: [{ invoiceid: 'mock-inv-1', invoicenumber: 'INV-01002-B2P4S4', name: 'Sales Invoice - Avani', totalamount: 29500 }]
      };
    }

    try {
      const token = await this.getAccessToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const [quotesRes, invRes] = await Promise.allSettled([
        axios.get(`${this.crmUrl}/api/data/v9.2/quotes?$filter=contains(name,'${qStr}') or contains(quotenumber,'${qStr}')&$select=quoteid,name,quotenumber,totalamount&$top=5`, { headers }),
        axios.get(`${this.crmUrl}/api/data/v9.2/invoices?$filter=contains(name,'${qStr}') or contains(invoicenumber,'${qStr}')&$select=invoiceid,name,invoicenumber,totalamount&$top=5`, { headers })
      ]);

      const quotes = quotesRes.status === 'fulfilled' ? quotesRes.value.data?.value || [] : [];
      const invoices = invRes.status === 'fulfilled' ? invRes.value.data?.value || [] : [];
      return { quotes, invoices };
    } catch (err) {
      return { quotes: [], invoices: [] };
    }
  }

  async getAllInvoicesSummary() {
    if (!this.isConfigured) {
      return {
        totalOutstanding: 29500,
        count: 1,
        invoices: [
          { invoicenumber: 'INV-01002-B2P4S4', name: 'Sales Invoice - Rina Patel', customer: 'Rina Patel', amount: 29500, status: 'New' }
        ]
      };
    }
    try {
      const token = await this.getAccessToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        Prefer: 'odata.include-annotations="*"'
      };
      const res = await axios.get(
        `${this.crmUrl}/api/data/v9.2/invoices?$select=invoiceid,name,invoicenumber,totalamount,duedate,statecode,statuscode,_customerid_value&$expand=customerid_contact($select=fullname,emailaddress1),customerid_account($select=name,emailaddress1)&$orderby=createdon desc&$top=50`,
        { headers }
      );
      const list = res.data?.value || [];
      let total = 0;
      const formatted = list.map(inv => {
        const amt = Number(inv.totalamount) || 0;
        total += amt;
        const custObj = inv.customerid_contact || inv.customerid_account || {};
        let customerName = custObj.fullname || custObj.name || inv['_customerid_value@OData.Community.Display.V1.FormattedValue'] || inv.name || 'Valued Customer';
        if (inv.name && inv.name.startsWith('Sales Invoice - ')) {
          const parsed = inv.name.replace('Sales Invoice - ', '').trim();
          if (parsed && (customerName === 'Valued Customer' || customerName === 'Hi Customer')) {
            customerName = parsed;
          }
        }
        const customerEmail = custObj.emailaddress1 || null;

        return {
          invoiceid: inv.invoiceid,
          name: inv.name,
          invoicenumber: inv.invoicenumber || 'N/A',
          customer: customerName,
          email: customerEmail,
          amount: amt,
          duedate: inv.duedate || null,
          statecode: inv.statecode,
          statuscode: inv.statuscode
        };
      });
      return {
        totalOutstanding: total,
        count: formatted.length,
        invoices: formatted
      };
    } catch (e) {
      console.warn('getAllInvoicesSummary error:', e.message);
      return {
        totalOutstanding: 29500,
        count: 1,
        invoices: [
          { invoicenumber: 'INV-01002-B2P4S4', name: 'Sales Invoice - Rina Patel', customer: 'Rina Patel', amount: 29500, duedate: '2026-10-20', status: 'New' }
        ]
      };
    }
  }

  /**
   * 🔍 Search Invoices by Customer name, Contact, or Invoice Number
   */
  async searchInvoicesByCustomer(customerQuery) {
    if (!customerQuery) return [];
    try {
      const summary = await this.getAllInvoicesSummary();
      const allInvoices = summary.invoices || [];
      const cleanQ = customerQuery.toLowerCase().trim().replace(/[\s\-_.]/g, '');
      return allInvoices.filter(inv => {
        const cName = (inv.customer || '').toLowerCase().replace(/[\s\-_.]/g, '');
        const invName = (inv.name || '').toLowerCase().replace(/[\s\-_.]/g, '');
        const num = (inv.invoicenumber || '').toLowerCase().replace(/[\s\-_.]/g, '');
        return cName.includes(cleanQ) || cleanQ.includes(cName) ||
               invName.includes(cleanQ) || cleanQ.includes(invName) ||
               num.includes(cleanQ);
      });
    } catch (e) {
      console.warn('searchInvoicesByCustomer error:', e.message);
      return [];
    }
  }

  getStatus() {
    return {
      isConfigured: this.isConfigured,
      crmUrl: this.crmUrl || 'Not configured',
      totalLeadsCaptured: capturedLeadsHistory.length,
    };
  }
}

module.exports = new DynamicsService();
