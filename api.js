const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = [
  7873520476,   // Ibrohim
  5285940949,   // Rustam
  8733385729    // 3-chi admin
];

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'shop.db')
  : '/data/shop.db';

// Yetkazish narxlari (so'm)
const DELIVERY_ZONES = {
  'Chilonzor':    15000,
  'Yunusobod':    15000,
  'Mirzo Ulugbek':15000,
  'Yakkasaroy':   15000,
  'Shayxontohur': 15000,
  'Uchtepa':      18000,
  'Olmazor':      18000,
  'Sergeli':      20000,
  'Bektemir':     22000,
  'Yangihayt':    25000,
  'Toshkent viloyati': 35000,
  'Boshqa':       30000
};

function getDb() {
  return new sqlite3.Database(DB_PATH);
}

// Telegram xabar yuborish
async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) return;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  return new Promise((resolve) => {
    const req = require('https').request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

// Barcha adminlarga xabar
async function notifyAdmins(text) {
  for (const adminId of ADMIN_IDS) {
    await sendTelegram(adminId, text);
  }
}

// CORS headers
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  setCors(res);

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  // ── GET /api/products ──────────────────────────────────────
  if (req.method === 'GET' && url === '/api/products') {
    const db = getDb();
    db.all(
      `SELECT p.id, p.name, p.price, p.stock, p.image_url,
              c.name AS category
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.stock > 0
       ORDER BY p.id`,
      [],
      (err, rows) => {
        db.close();
        if (err) return jsonResponse(res, { error: 'DB xatosi' }, 500);
        jsonResponse(res, rows || []);
      }
    );
    return;
  }

  // ── GET /api/delivery-zones ────────────────────────────────
  if (req.method === 'GET' && url === '/api/delivery-zones') {
    jsonResponse(res, DELIVERY_ZONES);
    return;
  }

  // ── POST /api/order ────────────────────────────────────────
  if (req.method === 'POST' && url === '/api/order') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let data;
      try { data = JSON.parse(body); } catch {
        return jsonResponse(res, { error: 'JSON xatosi' }, 400);
      }

      const { name, phone, address, district, items, note } = data;

      if (!name || !phone || !address || !district || !items || items.length === 0) {
        return jsonResponse(res, { error: "Majburiy maydonlar to'ldirilmagan" }, 400);
      }

      const delivery = DELIVERY_ZONES[district] || DELIVERY_ZONES['Boshqa'];
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const total = subtotal + delivery;

      // Buyurtma raqami
      const orderNum = `WEB-${Date.now().toString().slice(-6)}`;

      // DB ga saqlash
      const db = getDb();
      db.run(
        `INSERT INTO orders (order_num, customer_name, phone, address, total, status, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'new', 'web', datetime('now', '+5 hours'))`,
        [orderNum, name, phone, `${district}, ${address}`, total],
        function(err) {
          db.close();
          if (err) console.error('DB order xatosi:', err);
        }
      );

      // Mahsulotlar ro'yxati
      const itemsList = items.map(i =>
        `  • ${i.name} × ${i.qty} = ${(i.price * i.qty).toLocaleString('ru-RU')} so'm`
      ).join('\n');

      // Telegram xabari
      const msg =
`🌐 <b>YANGI BUYURTMA — SAYTDAN</b>
━━━━━━━━━━━━━━━━━━━━
📋 Buyurtma: <b>#${orderNum}</b>

👤 <b>Mijoz:</b> ${name}
📞 <b>Tel:</b> ${phone}
📍 <b>Manzil:</b> ${district}, ${address}
${note ? `📝 <b>Izoh:</b> ${note}\n` : ''}
🛍 <b>Mahsulotlar:</b>
${itemsList}

━━━━━━━━━━━━━━━━━━━━
💰 Mahsulotlar: ${subtotal.toLocaleString('ru-RU')} so'm
🚚 Yetkazish (${district}): ${delivery.toLocaleString('ru-RU')} so'm
💵 <b>JAMI: ${total.toLocaleString('ru-RU')} so'm</b>
━━━━━━━━━━━━━━━━━━━━
📌 Manba: <b>babydiaryuz.com sayt</b>`;

      await notifyAdmins(msg);
      jsonResponse(res, { success: true, orderNum, total });
    });
    return;
  }

  // ── GET / — HTML sayt ─────────────────────────────────────
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Xato'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`BabyDiary server ishlayapti: port ${PORT}`);
});
