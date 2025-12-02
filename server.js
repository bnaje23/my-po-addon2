const express = require('express');
const pdfkit = require('pdfkit');
const axios = require('axios');
const FormData = require('form-data');
const { Buffer } = require('buffer');

const app = express();
const PORT = process.env.PORT || 10000;  // Render sets PORT env var

app.use(express.json());  // Parse JSON bodies (for ServiceM8 POST)

// Your original createPO function (renamed & standalone)
async function createPO(req, res) {
  const { access_token, job_uuid, supplier_uuid } = req.body;

  if (!access_token || !job_uuid || !supplier_uuid) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const [jobRes, materialsRes] = await Promise.all([
      axios.get(`https://api.servicem8.com/api_1.0/job/${job_uuid}.json`, {
        headers: { Authorization: `Bearer ${access_token}` }
      }),
      axios.get(`https://api.servicem8.com/api_1.0/material.json?job_uuid=${job_uuid}`, {
        headers: { Authorization: `Bearer ${access_token}` }
      })
    ]);

    const job = jobRes.data;
    const materials = materialsRes.data.filter(m => m.quantity > 0);

    const supplierRes = await axios.get(
      `https://api.servicem8.com/api_1.0/contact/${supplier_uuid}.json`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const supplier = supplierRes.data;

    const doc = new pdfkit({ margin: 50 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    doc.fontSize(20).text('PURCHASE ORDER', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Job: ${job.job_number} – ${job.name}`);
    doc.text(`Date: ${new Date().toLocaleDateString()}`);
    doc.text(`Supplier: ${supplier.company_name || supplier.name}`);
    doc.text(`Email: ${supplier.email}`);
    doc.moveDown();
    doc.text('Items', { underline: true });
    materials.forEach((m, i) => {
      doc.text(
        `${i + 1}. ${m.description} × ${m.quantity} @ $${m.cost_each} = $${(m.quantity * m.cost_each).toFixed(2)}`
      );
    });
    const total = materials.reduce((sum, m) => sum + m.quantity * m.cost_each, 0).toFixed(2);
    doc.moveDown().fontSize(14).text(`TOTAL: $${total}`, { align: 'right' });
    doc.end();

    await new Promise(resolve => doc.on('end', resolve));
    const pdfBuffer = Buffer.concat(chunks);

    const form = new FormData();
    form.append('diary_entry[entry_type]', 'Information');
    form.append('diary_entry[message]', `PO sent to ${supplier.company_name || supplier.name}`);
    form.append('diary_entry[attached_file]', pdfBuffer, {
      filename: `PO_${job.job_number}.pdf`,
      contentType: 'application/pdf'
    });

    await axios.post(
      `https://api.servicem8.com/api_1.0/diaryentry.json?job_uuid=${job_uuid}`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${access_token}`
        }
      }
    );

    // UPDATE PO STATUS
    const statusFieldUuid = 'CUSTOM_FIELD_UUID_FOR_PO_STATUS'; // ← CHANGE LATER
    await axios.put(
      `https://api.servicem8.com/api_1.0/job/${job_uuid}.json`,
      {
        custom_fields: [{ uuid: statusFieldUuid, value: 'Sent' }]
      },
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    res.json({ success: true, message: 'PO created & attached' });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: err.message });
  }
}

// Route: POST /api/create-po
app.post('/api/create-po', createPO);

// Health check route (optional, for Render)
app.get('/', (req, res) => res.send('MyPO Add-on Ready!'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
