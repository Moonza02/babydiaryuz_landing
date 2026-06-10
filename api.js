const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = [5285940949, 512101064, 8733385729];

// Bot /app/products.json ga saqlaydi — sayt ham o'sha yerdan o'qiydi
const PRODUCTS_FILE = '/app/products.json';

const DELIVERY_ZONES = {
  'Chilonzor': 15000, 'Yunusobod': 15000, 'Mirzo Ulugbek': 15000,
  'Yakkasaroy': 15000, 'Shayxontohur': 15000, 'Uchtepa': 18000,
  'Olmazor': 18000, 'Sergeli': 20000, 'Bektemir': 22000,
  'Yangihayt': 25000, 'Toshkent viloyati': 35000, 'Boshqa': 30000
};

async function getProducts() {
  try {
    // GitHub raw dan real-time o'qish (bot push qilganda yangilanadi)
    const url = 'https://raw.githubusercontent.com/Moonza02/babydiaryuz_landing/main/products.json?t=' + Date.now();
    const data = await new Promise((resolve, reject) => {
      require('https').get(url, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });
    return JSON.parse(data);
  } catch {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8');
      return JSON.parse(raw);
    } catch { return []; }
  }
}

function sendTelegram(chatId, text) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN) { resolve(); return; }
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

async function notifyAdmins(text) {
  for (const id of ADMIN_IDS) await sendTelegram(id, text);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  // GET /api/products — products.json dan real-time
  if (req.method === 'GET' && url === '/api/products') {
    getProducts().then(function(products) {
      var active = products.filter(function(p) { return !p.stock || parseInt(p.stock) > 0; });
      json(res, active);
    }).catch(function() { json(res, []); });
    return;
  }

  // GET /api/categories — mavjud kategoriyalar
  if (req.method === 'GET' && url === '/api/categories') {
    getProducts().then(function(products) {
      var cats = [...new Set(products.map(function(p){return p.category;}).filter(Boolean))];
      json(res, cats);
    }).catch(function() { json(res, []); });
    return;
  }

  // GET /api/delivery-zones
  if (req.method === 'GET' && url === '/api/delivery-zones') {
    return json(res, DELIVERY_ZONES);
  }

  // POST /api/order
  if (req.method === 'POST' && url === '/api/order') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      let data;
      try { data = JSON.parse(body); } catch { return json(res, { error: 'JSON xato' }, 400); }

      const { name, phone, address, district, items, note } = data;
      if (!name || !phone || !address || !district || !items?.length) {
        return json(res, { error: "Maydonlar to'liq emas" }, 400);
      }

      const delivery = DELIVERY_ZONES[district] || 30000;
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const total = subtotal + delivery;
      const orderNum = 'WEB-' + Date.now().toString().slice(-6);

      const itemsList = items.map(i =>
        `  • ${i.name} × ${i.qty} = ${(i.price * i.qty).toLocaleString('ru-RU')} so'm`
      ).join('\n');

      const msg =
`🌐 <b>YANGI BUYURTMA — SAYTDAN</b>
━━━━━━━━━━━━━━━━━━━━
📋 Buyurtma: <b>#${orderNum}</b>

👤 <b>Mijoz:</b> ${name}
📞 <b>Tel:</b> ${phone}
📍 <b>Manzil:</b> ${district}, ${address}${note ? '\n📝 <b>Izoh:</b> ' + note : ''}

🛍 <b>Mahsulotlar:</b>
${itemsList}

━━━━━━━━━━━━━━━━━━━━
💰 Mahsulotlar: ${subtotal.toLocaleString('ru-RU')} so'm
🚚 Yetkazish (${district}): ${delivery.toLocaleString('ru-RU')} so'm
💵 <b>JAMI: ${total.toLocaleString('ru-RU')} so'm</b>
━━━━━━━━━━━━━━━━━━━━
📌 Manba: <b>babydiaryuz.com sayt</b>`;

      await notifyAdmins(msg);
      json(res, { success: true, orderNum, total });
    });
    return;
  }

  // GET / — HTML sayt
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const file = path.join(__dirname, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); res.end('Xato'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BabyDiary sayt serveri: port ${PORT}`);
  console.log(`Products fayl: ${PRODUCTS_FILE}`);
  console.log(`/data mavjud: ${fs.existsSync('/data')}`);
});
