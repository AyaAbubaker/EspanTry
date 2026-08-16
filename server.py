#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, re, json, csv, io, time, hmac, hashlib, secrets, sqlite3, mimetypes, urllib.parse, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / 'frontend'
DATA_DIR = ROOT / 'data'
DB_PATH = Path(os.environ.get('ESPAN_DB_PATH', str(DATA_DIR / 'espan.sqlite3'))).resolve()
PORT = int(os.environ.get('PORT', '3000'))
BIND_HOST = os.environ.get('ESPAN_BIND_HOST', '127.0.0.1')
STRICT_PORT = os.environ.get('ESPAN_STRICT_PORT', '0').strip().lower() in ('1','true','yes','on')
SECURE_COOKIE = os.environ.get('ESPAN_SECURE_COOKIE', '0').strip().lower() in ('1','true','yes','on')
SESSION_COOKIE = 'espan_session'
SESSION_DAYS = 7
MAX_BODY_BYTES = int(os.environ.get('ESPAN_MAX_BODY_BYTES', str(10 * 1024 * 1024)))
PASSWORD_ITERATIONS = 600_000
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

ORDER_STATUSES = ['طلب جديد','تم التأكيد','قيد التجهيز','جاهز للتوصيل','خرج للتوصيل','تم التسليم','ملغي']

# حماية بسيطة لمحاولات تسجيل الدخول لهذا الخادم المحلي.
# في الاستضافة متعددة الخوادم يفضل نقلها إلى Redis / reverse proxy.
LOGIN_WINDOW_SECONDS = 5 * 60
LOGIN_PAIR_LIMIT = 5
LOGIN_IP_LIMIT = 20
_login_attempts = {}
_login_lock = threading.Lock()

REGISTER_WINDOW_SECONDS = 10 * 60
REGISTER_IP_LIMIT = 8
_register_attempts = {}
_register_lock = threading.Lock()

def _prune_attempts(values, now):
    cutoff = now - LOGIN_WINDOW_SECONDS
    return [t for t in values if t >= cutoff]

def login_rate_status(ip, phone):
    now = time.time()
    pair_key = f'pair:{ip}:{phone}'
    ip_key = f'ip:{ip}'
    with _login_lock:
        pair = _prune_attempts(_login_attempts.get(pair_key, []), now)
        ip_values = _prune_attempts(_login_attempts.get(ip_key, []), now)
        _login_attempts[pair_key] = pair
        _login_attempts[ip_key] = ip_values
        blocked = len(pair) >= LOGIN_PAIR_LIMIT or len(ip_values) >= LOGIN_IP_LIMIT
        values = pair if len(pair) >= LOGIN_PAIR_LIMIT else ip_values
        retry_after = max(1, int(LOGIN_WINDOW_SECONDS - (now - values[0]))) if blocked and values else 0
        return blocked, retry_after

def record_login_failure(ip, phone):
    now = time.time()
    with _login_lock:
        for key in (f'pair:{ip}:{phone}', f'ip:{ip}'):
            values = _prune_attempts(_login_attempts.get(key, []), now)
            values.append(now)
            _login_attempts[key] = values

def clear_login_pair(ip, phone):
    with _login_lock:
        _login_attempts.pop(f'pair:{ip}:{phone}', None)

def register_rate_status(ip):
    now = time.time()
    cutoff = now - REGISTER_WINDOW_SECONDS
    with _register_lock:
        values = [t for t in _register_attempts.get(ip, []) if t >= cutoff]
        _register_attempts[ip] = values
        if len(values) >= REGISTER_IP_LIMIT:
            retry_after = max(1, int(REGISTER_WINDOW_SECONDS - (now - values[0])))
            return True, retry_after
        return False, 0

def record_register_attempt(ip):
    now = time.time()
    cutoff = now - REGISTER_WINDOW_SECONDS
    with _register_lock:
        values = [t for t in _register_attempts.get(ip, []) if t >= cutoff]
        values.append(now)
        _register_attempts[ip] = values

def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')

def uid(prefix):
    return f"{prefix}-{int(time.time()*1000):x}-{secrets.token_hex(3)}"

def normalize_phone(value):
    p = ''.join(ch for ch in str(value or '') if ch.isdigit())
    if p.startswith('00218'): p = '0' + p[5:]
    elif p.startswith('218'): p = '0' + p[3:]
    if re.fullmatch(r'9[1-5]\d{7}', p): p = '0' + p
    return p

def hash_password(password, salt=None, iterations=PASSWORD_ITERATIONS):
    salt = salt or secrets.token_hex(16)
    iterations = int(iterations)
    digest = hashlib.pbkdf2_hmac('sha256', str(password).encode(), salt.encode(), iterations).hex()
    return f"pbkdf2_sha256${iterations}${salt}${digest}"

RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

def generate_recovery_code():
    part1 = ''.join(secrets.choice(RECOVERY_ALPHABET) for _ in range(4))
    part2 = ''.join(secrets.choice(RECOVERY_ALPHABET) for _ in range(4))
    return f"ESP-{part1}-{part2}"

def verify_password(password, stored):
    try:
        parts = str(stored or '').split('$')
        if len(parts) == 3 and parts[0] == 'pbkdf2':
            # توافق مع النسخ الأقدم من المشروع.
            _, salt, expected = parts
            iterations = 180_000
        elif len(parts) == 4 and parts[0] == 'pbkdf2_sha256':
            _, raw_iterations, salt, expected = parts
            iterations = int(raw_iterations)
            if iterations < 100_000 or iterations > 2_000_000:
                return False
        else:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', str(password).encode(), salt.encode(), iterations).hex()
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False

def password_hash_needs_upgrade(stored):
    try:
        parts = str(stored or '').split('$')
        return not (len(parts) == 4 and parts[0] == 'pbkdf2_sha256' and int(parts[1]) >= PASSWORD_ITERATIONS)
    except Exception:
        return True

def session_token_hash(token):
    return hashlib.sha256(str(token or '').encode('utf-8')).hexdigest()

def parse_cookies(handler):
    result = {}
    raw = handler.headers.get('Cookie', '')
    for part in raw.split(';'):
        if '=' not in part:
            continue
        key, value = part.split('=', 1)
        result[key.strip()] = urllib.parse.unquote(value.strip())
    return result

def session_cookie_header(token, max_age=None):
    attrs = [f'{SESSION_COOKIE}={urllib.parse.quote(str(token))}', 'Path=/', 'HttpOnly', 'SameSite=Strict']
    if SECURE_COOKIE:
        attrs.append('Secure')
    if max_age is not None:
        attrs.append(f'Max-Age={int(max_age)}')
    return '; '.join(attrs)

def clear_session_cookie_header():
    attrs = [f'{SESSION_COOKIE}=', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
    if SECURE_COOKIE:
        attrs.append('Secure')
    return '; '.join(attrs)

def jdump(v): return json.dumps(v, ensure_ascii=False)
def jload(v, default=None):
    if v in (None, ''): return [] if default is None else default
    try: return json.loads(v)
    except Exception: return [] if default is None else default

def db():
    con = sqlite3.connect(DB_PATH, timeout=20)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA journal_mode=WAL')
    return con

def init_db(reset=False):
    if reset and DB_PATH.exists(): DB_PATH.unlink()
    con = db()
    con.executescript('''
    CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL,
      city TEXT DEFAULT '', address TEXT DEFAULT '', role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products(
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0, quantity INTEGER NOT NULL DEFAULT 0,
      image TEXT DEFAULT '', frames TEXT DEFAULT '[]', description TEXT DEFAULT '',
      featured INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offers(
      id TEXT PRIMARY KEY, product_id INTEGER NOT NULL, type TEXT NOT NULL,
      value REAL NOT NULL, min_quantity INTEGER NOT NULL DEFAULT 1,
      start_date TEXT DEFAULT '', end_date TEXT DEFAULT '',
      active INTEGER DEFAULT 1, title TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orders(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_name TEXT NOT NULL,
      customer_phone TEXT DEFAULT '', address TEXT DEFAULT '', total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'طلب جديد', delivery_id TEXT DEFAULT '', delivery_name TEXT DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT 'نقدًا', notes TEXT DEFAULT '', timeline TEXT DEFAULT '[]',
      cash_handed_over INTEGER DEFAULT 0, cash_handed_at TEXT DEFAULT '',
      cash_confirmed INTEGER DEFAULT 0, cash_confirmed_at TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_items(
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, product_id INTEGER,
      product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS favorites(user_id TEXT NOT NULL, product_id INTEGER NOT NULL, PRIMARY KEY(user_id,product_id));
    CREATE TABLE IF NOT EXISTS cart(user_id TEXT NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, PRIMARY KEY(user_id,product_id));
    CREATE TABLE IF NOT EXISTS reviews(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT NOT NULL, product_id INTEGER NOT NULL,
      rating INTEGER NOT NULL, comment TEXT DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE(user_id,order_id,product_id)
    );
    CREATE TABLE IF NOT EXISTS complaints(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT DEFAULT '', customer_name TEXT NOT NULL,
      message TEXT NOT NULL, status TEXT DEFAULT 'جديدة', reply TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT DEFAULT 'info', title TEXT NOT NULL,
      message TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity(
      id TEXT PRIMARY KEY, actor_id TEXT DEFAULT '', actor TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings(
      id INTEGER PRIMARY KEY CHECK(id=1), business_name TEXT DEFAULT 'ESPAN Woodwork',
      admin_whatsapp TEXT DEFAULT '0913219196', business_phone TEXT DEFAULT '0913219196',
      low_stock_threshold INTEGER DEFAULT 3
    );
    INSERT OR IGNORE INTO settings(id) VALUES(1);
    ''')
    # ترقية order_items حتى يمكن حذف منتج من الكتالوج مع بقاء تفاصيل الطلبات القديمة.
    item_cols = {row['name']: row for row in con.execute('PRAGMA table_info(order_items)')}
    item_fks = list(con.execute('PRAGMA foreign_key_list(order_items)'))
    product_fk = next((row for row in item_fks if row['table'] == 'products' and row['from'] == 'product_id'), None)
    needs_item_migration = bool(item_cols.get('product_id') and int(item_cols['product_id']['notnull'])) or not product_fk or str(product_fk['on_delete']).upper() != 'SET NULL'
    if needs_item_migration:
        con.commit()
        con.execute('PRAGMA foreign_keys=OFF')
        con.executescript("""
        ALTER TABLE order_items RENAME TO order_items_legacy;
        CREATE TABLE order_items(
          id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, product_id INTEGER,
          product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL,
          FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
          FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
        );
        INSERT INTO order_items(id,order_id,product_id,product_name,quantity,unit_price,line_total)
          SELECT id,order_id,product_id,product_name,quantity,unit_price,line_total FROM order_items_legacy;
        DROP TABLE order_items_legacy;
        """)
        con.execute('PRAGMA foreign_keys=ON')

    # إضافة رمز استرجاع مشفر لحسابات المستخدمين بدون حذف أي بيانات قديمة.
    user_cols = {row['name'] for row in con.execute('PRAGMA table_info(users)')}
    if 'recovery_code_hash' not in user_cols:
        con.execute("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT DEFAULT ''")

    # ترقيات آمنة لقواعد البيانات القديمة دون حذف بيانات المستخدم.
    complaint_cols = {row['name'] for row in con.execute('PRAGMA table_info(complaints)')}
    if 'product_id' not in complaint_cols:
        con.execute('ALTER TABLE complaints ADD COLUMN product_id INTEGER DEFAULT 0')
    if 'product_name' not in complaint_cols:
        con.execute("ALTER TABLE complaints ADD COLUMN product_name TEXT DEFAULT ''")
    offer_cols = {row['name'] for row in con.execute('PRAGMA table_info(offers)')}
    if 'min_quantity' not in offer_cols:
        con.execute('ALTER TABLE offers ADD COLUMN min_quantity INTEGER NOT NULL DEFAULT 1')
    con.execute('UPDATE offers SET min_quantity=1 WHERE min_quantity IS NULL OR min_quantity<1')
    con.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_complaint_user_product ON complaints(user_id, product_id) WHERE product_id > 0')
    # ميزة «منتج مميز» ألغيت من الواجهة نهائيًا.
    con.execute('UPDATE products SET featured=0 WHERE featured<>0')
    if con.execute('SELECT COUNT(*) n FROM products').fetchone()['n'] == 0:
        seed_catalog(con)
    con.commit(); con.close()

def seed_catalog(con):
    ts = now_iso()
    products = [
      ('سرير أطفال خشبي','غرف الأطفال',1850,5,'Images/photo_2026-08-01_20-52-09.jpg',[], 'سرير خشبي منفذ بعناية مع تشطيب هادئ وحواف ناعمة.',1),
      ('مرآة أرضية خشبية','الديكور الداخلي',1450,4,'Images/photo_2026-08-01_20-52-10.jpg',[], 'مرآة طويلة بإطار خشبي أنيق للمداخل وغرف النوم.',1),
      ('فاصل خشبي للمساحات','تقسيم المساحات',2100,2,'Images/photo_2026-08-01_20-52-13.jpg',[], 'فاصل ديكوري يمنح المكان خصوصية مع الحفاظ على الإضاءة.',0),
      ('طاولة قهوة خشبية','الأثاث',780,6,'Images/photo_2026-08-01_20-52-16.jpg',[], 'طاولة قهوة بسيطة وأنيقة بلمسة خشبية دافئة.',0),
      ('سُلّم خشبي متين','قطع عملية',950,3,'Images/ladder-360/ladder-00.png',[f'Images/ladder-360/ladder-{i:02d}.png' for i in range(8)], 'سُلّم عملي قابل للطي مع عرض تفاعلي من عدة زوايا.',1),
      ('حامل قرآن خشبي','قطع مميزة',1250,0,'Images/photo_2026-08-01_20-52-18.jpg',[], 'قطعة عملية بتفاصيل خشبية دقيقة وتشطيب أنيق.',0),
    ]
    for name,cat,price,qty,img,frames,desc,featured in products:
        con.execute('INSERT INTO products(name,category,price,quantity,image,frames,description,featured,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (name,cat,price,qty,img,jdump(frames),desc,featured,ts,ts))
    con.execute('INSERT INTO offers(id,product_id,type,value,min_quantity,start_date,end_date,active,title,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                ('offer-welcome',1,'percentage',10,1,'','',1,'عرض ترحيبي',ts))
    activity(con,'','النظام','تم تجهيز بيانات الكتالوج الأساسية')

def activity(con, actor_id, actor, text):
    con.execute('INSERT INTO activity(id,actor_id,actor,text,created_at) VALUES(?,?,?,?,?)', (uid('act'),actor_id or '',actor or 'النظام',text,now_iso()))

def notify(con, user_id, title, message, type_='info'):
    con.execute('INSERT INTO notifications(id,user_id,type,title,message,is_read,created_at) VALUES(?,?,?,?,?,0,?)',
                (uid('not'),user_id,type_,title,message,now_iso()))

def notify_role(con, role, title, message, type_='info'):
    for r in con.execute('SELECT id FROM users WHERE role=? AND status="active"',(role,)):
        notify(con,r['id'],title,message,type_)

def user_dict(r):
    return {'id':r['id'],'full_name':r['full_name'],'phone':r['phone'],'city':r['city'] or '','address':r['address'] or '',
            'role':r['role'],'status':r['status'],'createdAt':r['created_at']}

def active_offer(con, product_id):
    today = datetime.now().date().isoformat()
    return con.execute('''SELECT * FROM offers WHERE product_id=? AND active=1
       AND (start_date='' OR start_date<=?) AND (end_date='' OR end_date>=?) ORDER BY created_at DESC LIMIT 1''',(product_id,today,today)).fetchone()

def product_dict(con, r):
    stats = con.execute('SELECT COALESCE(AVG(rating),0) a, COUNT(*) c FROM reviews WHERE product_id=?',(r['id'],)).fetchone()
    sold = con.execute('''SELECT COALESCE(SUM(oi.quantity),0) s FROM order_items oi JOIN orders o ON o.id=oi.order_id
                          WHERE oi.product_id=? AND o.status='تم التسليم' ''',(r['id'],)).fetchone()['s']
    return {'id':r['id'],'name':r['name'],'category':r['category'],'price':float(r['price']),'quantity':int(r['quantity']),
            'available':int(r['quantity'])>0,'image':r['image'] or 'Images/ESPAN-logo-transparent.png','frames':jload(r['frames'],[]),
            'description':r['description'] or '','featured':bool(r['featured']),'soldCount':int(sold or 0),
            'reviewAverage':round(float(stats['a'] or 0),2),'reviewCount':int(stats['c'] or 0),
            'createdAt':r['created_at'],'updatedAt':r['updated_at']}

def offer_dict(r):
    keys=set(r.keys())
    return {'id':r['id'],'productId':int(r['product_id']),'type':r['type'],'value':float(r['value']),
            'minQuantity':max(1,int(r['min_quantity'] or 1)) if 'min_quantity' in keys else 1,
            'startDate':r['start_date'] or '','endDate':r['end_date'] or '','active':bool(r['active']),
            'title':r['title'],'createdAt':r['created_at']}

def order_dict(con, r):
    items=[]
    for x in con.execute('''SELECT oi.*,p.image FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? ORDER BY oi.id''',(r['id'],)):
        items.append({'id':x['id'],'productId':x['product_id'],'productName':x['product_name'],'quantity':x['quantity'],
                      'unitPrice':float(x['unit_price']),'total':float(x['line_total']),'image':x['image'] or 'Images/ESPAN-logo-transparent.png'})
    qty=sum(i['quantity'] for i in items)
    pname = items[0]['productName'] if len(items)==1 else (f"{items[0]['productName']} + {len(items)-1} منتج" if items else 'طلب')
    pid=items[0]['productId'] if len(items)==1 else None
    unit=items[0]['unitPrice'] if len(items)==1 else 0
    return {'id':r['id'],'userId':r['user_id'],'customerName':r['customer_name'],'customerPhone':r['customer_phone'] or '',
            'address':r['address'] or '','productId':pid,'productName':pname,'quantity':qty,'unitPrice':unit,'total':float(r['total']),
            'status':r['status'],'deliveryId':r['delivery_id'] or '','deliveryName':r['delivery_name'] or '',
            'paymentMethod':'نقدًا','notes':r['notes'] or '','timeline':jload(r['timeline'],[]),
            'cashHandedOver':bool(r['cash_handed_over']),'cashHandedAt':r['cash_handed_at'] or None,
            'cashConfirmed':bool(r['cash_confirmed']),'cashConfirmedAt':r['cash_confirmed_at'] or None,
            'items':items,'createdAt':r['created_at'],'updatedAt':r['updated_at']}

def review_dict(con,r):
    u=con.execute('SELECT full_name FROM users WHERE id=?',(r['user_id'],)).fetchone()
    return {'id':r['id'],'userId':r['user_id'],'orderId':r['order_id'],'productId':r['product_id'],'rating':r['rating'],
            'comment':r['comment'] or '','customerName':u['full_name'] if u else 'عميل','createdAt':r['created_at']}

def complaint_dict(r):
    keys=set(r.keys())
    return {'id':r['id'],'userId':r['user_id'],'orderId':r['order_id'] or '',
            'productId':int(r['product_id'] or 0) if 'product_id' in keys else 0,
            'productName':(r['product_name'] or '') if 'product_name' in keys else '',
            'customerName':r['customer_name'],'message':r['message'],
            'status':r['status'],'reply':r['reply'] or '','createdAt':r['created_at']}

def notification_dict(r):
    return {'id':r['id'],'type':r['type'],'title':r['title'],'message':r['message'],'read':bool(r['is_read']),'createdAt':r['created_at']}

def auth_user(handler, con):
    raw_token = parse_cookies(handler).get(SESSION_COOKIE, '')
    if not raw_token:
        return None
    token_hash = session_token_hash(raw_token)
    s = con.execute('SELECT * FROM sessions WHERE token=?', (token_hash,)).fetchone()
    if not s:
        return None
    try:
        if datetime.fromisoformat(s['expires_at'].replace('Z','+00:00')) < datetime.now(timezone.utc):
            con.execute('DELETE FROM sessions WHERE token=?', (token_hash,))
            con.commit()
            return None
    except Exception:
        con.execute('DELETE FROM sessions WHERE token=?', (token_hash,))
        con.commit()
        return None
    u = con.execute('SELECT * FROM users WHERE id=? AND status="active"', (s['user_id'],)).fetchone()
    if not u:
        con.execute('DELETE FROM sessions WHERE token=?', (token_hash,))
        con.commit()
    return u

def price_for(con, product_id, base_price, quantity=1):
    """Return unit price using the CURRENT product price and only when the offer condition is met.
    Supported discounts: percentage, or fixed_amount (amount subtracted from the current price).
    Legacy 'fixed' offers are treated as fixed_amount to avoid hard-coding a replacement product price.
    """
    base=float(base_price)
    off=active_offer(con,product_id)
    if not off: return base
    keys=set(off.keys())
    minimum=max(1,int(off['min_quantity'] or 1)) if 'min_quantity' in keys else 1
    if int(quantity or 0) < minimum: return base
    value=max(0,float(off['value'] or 0))
    if off['type']=='percentage': return max(0,base*(1-value/100))
    return max(0,base-value)

def bootstrap(con,user):
    products=[product_dict(con,r) for r in con.execute('SELECT * FROM products ORDER BY id')]
    offers=[offer_dict(r) for r in con.execute('SELECT * FROM offers ORDER BY created_at DESC')]
    settings_row=con.execute('SELECT * FROM settings WHERE id=1').fetchone()
    settings={'businessName':settings_row['business_name'],'adminWhatsApp':settings_row['admin_whatsapp'],
              'businessPhone':settings_row['business_phone'],'lowStockThreshold':settings_row['low_stock_threshold'],
              'pushEnabled':False}
    base={'products':products,'offers':offers,'users':[],'orders':[],'complaints':[],'notifications':[],
          'activity':[],'favorites':[],'cart':[],'reviews':[],'reports':None,'settings':settings}
    if not user: return base
    role=user['role']; uid_=user['id']
    if role=='admin':
        base['users']=[user_dict(r) for r in con.execute('SELECT * FROM users ORDER BY created_at DESC')]
        base['orders']=[order_dict(con,r) for r in con.execute('SELECT * FROM orders ORDER BY created_at DESC')]
        base['complaints']=[complaint_dict(r) for r in con.execute('SELECT * FROM complaints ORDER BY created_at DESC')]
        base['activity']=[{'id':r['id'],'text':r['text'],'actor':r['actor'],'createdAt':r['created_at']} for r in con.execute('SELECT * FROM activity ORDER BY created_at DESC LIMIT 500')]
        base['notifications']=[notification_dict(r) for r in con.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC',(uid_,))]
        base['reviews']=[review_dict(con,r) for r in con.execute('SELECT * FROM reviews ORDER BY created_at DESC')]
    elif role=='delivery':
        base['users']=[user_dict(user)]
        # المندوب لا يرى أي طلب إلا إذا أسندته الإدارة له صراحةً.
        base['orders']=[order_dict(con,r) for r in con.execute('SELECT * FROM orders WHERE delivery_id=? ORDER BY created_at DESC',(uid_,))]
        base['notifications']=[notification_dict(r) for r in con.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC',(uid_,))]
    else:
        base['users']=[user_dict(user)]
        base['orders']=[order_dict(con,r) for r in con.execute('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC',(uid_,))]
        base['favorites']=[r['product_id'] for r in con.execute('SELECT product_id FROM favorites WHERE user_id=?',(uid_,))]
        base['cart']=[{'productId':r['product_id'],'quantity':r['quantity']} for r in con.execute('SELECT * FROM cart WHERE user_id=?',(uid_,))]
        base['reviews']=[review_dict(con,r) for r in con.execute('SELECT * FROM reviews WHERE user_id=? ORDER BY created_at DESC',(uid_,))]
        base['complaints']=[complaint_dict(r) for r in con.execute('SELECT * FROM complaints WHERE user_id=? ORDER BY created_at DESC',(uid_,))]
        base['notifications']=[notification_dict(r) for r in con.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC',(uid_,))]
    return base

class Handler(BaseHTTPRequestHandler):
    server_version='ESPAN'
    sys_version=''
    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt%args}")
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Referrer-Policy','strict-origin-when-cross-origin')
        self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()')
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; "
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
        if SECURE_COOKIE:
            self.send_header('Strict-Transport-Security','max-age=31536000; includeSubDomains')
        super().end_headers()
    def send_json(self, obj, status=200, extra_headers=None):
        raw=json.dumps(obj,ensure_ascii=False).encode('utf-8')
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store')
        for key,value in (extra_headers or {}).items(): self.send_header(str(key),str(value))
        self.end_headers(); self.wfile.write(raw)
    def body_json(self):
        try:
            n = int(self.headers.get('Content-Length','0') or 0)
        except Exception:
            raise ValueError('حجم الطلب غير صحيح.')
        if n < 0 or n > MAX_BODY_BYTES:
            raise ValueError('حجم الطلب أكبر من الحد المسموح.')
        raw = self.rfile.read(n) if n else b'{}'
        try:
            value = json.loads(raw.decode('utf-8') or '{}')
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError('صيغة البيانات غير صحيحة.')
        if not isinstance(value, dict):
            raise ValueError('صيغة البيانات غير صحيحة.')
        return value
    def same_origin_ok(self):
        origin = self.headers.get('Origin','').strip()
        if not origin:
            return True
        try:
            origin_host = urllib.parse.urlparse(origin).netloc.lower()
            request_host = self.headers.get('Host','').strip().lower()
            return bool(origin_host and request_host and origin_host == request_host)
        except Exception:
            return False
    def require(self, con, roles=None):
        u=auth_user(self,con)
        if not u:
            self.send_json({'ok':False,'message':'يجب تسجيل الدخول أولًا.'},401); return None
        if roles and u['role'] not in roles:
            self.send_json({'ok':False,'message':'ليس لديك صلاحية لهذه العملية.'},403); return None
        return u
    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PATCH(self): self.route('PATCH')
    def do_PUT(self): self.route('PUT')
    def do_DELETE(self): self.route('DELETE')
    def route(self,method):
        parsed=urllib.parse.urlparse(self.path); p=parsed.path
        if p.startswith('/api/'):
            if method in ('POST','PATCH','PUT','DELETE') and not self.same_origin_ok():
                return self.send_json({'ok':False,'message':'تم رفض الطلب لأسباب أمنية.'},403)
            con=db()
            try: self.api(con,method,p)
            except sqlite3.IntegrityError as e: self.send_json({'ok':False,'message':'البيانات مكررة أو مرتبطة بسجل آخر.'},400)
            except ValueError as e: self.send_json({'ok':False,'message':str(e)},400)
            except Exception as e:
                print('API ERROR',repr(e)); self.send_json({'ok':False,'message':'حدث خطأ داخلي. حاولي مرة أخرى.'},500)
            finally: con.close()
        else: self.static(p)
    def static(self,p):
        if p=='/': p='/index.html'
        rel=urllib.parse.unquote(p.lstrip('/'))
        target=(FRONTEND/rel).resolve()
        if FRONTEND not in target.parents and target!=FRONTEND:
            self.send_error(403); return
        if not target.exists() or not target.is_file(): self.send_error(404); return
        raw=target.read_bytes(); ctype=mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        self.send_response(200); self.send_header('Content-Type',ctype + ('; charset=utf-8' if ctype.startswith('text/') or ctype in ('application/javascript','application/json') else ''))
        self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-cache'); self.end_headers(); self.wfile.write(raw)
    def api(self,con,method,p):
        # health / bootstrap
        if method=='GET' and p=='/api/health': return self.send_json({'ok':True,'service':'ESPAN','database':'sqlite','version':'final-production-cookie-security'})
        if method=='GET' and p=='/api/bootstrap':
            u=auth_user(self,con); return self.send_json({'ok':True,'authenticated':bool(u),'user':user_dict(u) if u else None,'data':bootstrap(con,u)})
        # auth
        if method=='POST' and p=='/api/auth/login':
            b=self.body_json(); phone=normalize_phone(b.get('phone')); pw=str(b.get('password') or '')
            ip=self.client_address[0] if self.client_address else 'unknown'
            blocked,retry_after=login_rate_status(ip,phone)
            if blocked:
                return self.send_json({'ok':False,'message':'محاولات تسجيل دخول كثيرة. حاولي بعد قليل.'},429,{'Retry-After':retry_after})
            u=con.execute('SELECT * FROM users WHERE phone=?',(phone,)).fetchone()
            if not u or u['status']!='active' or not verify_password(pw,u['password_hash']):
                record_login_failure(ip,phone)
                return self.send_json({'ok':False,'message':'رقم الهاتف أو كلمة المرور غير صحيحة.'},401)
            clear_login_pair(ip,phone)
            if password_hash_needs_upgrade(u['password_hash']):
                con.execute('UPDATE users SET password_hash=?,updated_at=? WHERE id=?', (hash_password(pw), now_iso(), u['id']))
            raw_token = secrets.token_urlsafe(32)
            exp = (datetime.now(timezone.utc)+timedelta(days=SESSION_DAYS)).replace(microsecond=0).isoformat().replace('+00:00','Z')
            con.execute('DELETE FROM sessions WHERE expires_at<?', (now_iso(),))
            con.execute('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', (session_token_hash(raw_token),u['id'],exp))
            con.commit()
            u=con.execute('SELECT * FROM users WHERE id=?',(u['id'],)).fetchone()
            return self.send_json({'ok':True,'user':user_dict(u)}, extra_headers={'Set-Cookie':session_cookie_header(raw_token, SESSION_DAYS*86400)})
        if method=='POST' and p=='/api/auth/logout':
            raw_token = parse_cookies(self).get(SESSION_COOKIE, '')
            if raw_token:
                con.execute('DELETE FROM sessions WHERE token=?', (session_token_hash(raw_token),))
                con.commit()
            return self.send_json({'ok':True}, extra_headers={'Set-Cookie':clear_session_cookie_header()})
        if method=='POST' and p=='/api/auth/register':
            ip = self.client_address[0] if self.client_address else 'unknown'
            blocked, retry_after = register_rate_status(ip)
            if blocked:
                return self.send_json(
                    {'ok':False,'message':'تم إنشاء عدد كبير من الحسابات من هذا الجهاز. حاولي بعد قليل.'},
                    429,
                    {'Retry-After': retry_after}
                )
            record_register_attempt(ip)
            b=self.body_json(); name=str(b.get('full_name') or '').strip(); phone=normalize_phone(b.get('phone')); pw=str(b.get('password') or '')
            if len(name)<3: raise ValueError('الاسم الكامل قصير.')
            if not re.fullmatch(r'09\d{8}',phone): raise ValueError('رقم الهاتف يجب أن يكون مثل 0912345678.')
            if len(pw)<8: raise ValueError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.')
            if con.execute('SELECT 1 FROM users WHERE phone=?',(phone,)).fetchone(): raise ValueError('رقم الهاتف مسجل مسبقًا.')
            ts = now_iso()
            id_ = uid('usr')
            recovery_code = generate_recovery_code()
            con.execute(
                '''
                INSERT INTO users(
                    id, full_name, phone, city, address, role, status,
                    password_hash, recovery_code_hash, created_at, updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                ''',
                (
                    id_, name, phone, b.get('city',''), b.get('address',''),
                    'customer', 'active', hash_password(pw),
                    hash_password(recovery_code), ts, ts
                )
            )
            activity(con,id_,name,'إنشاء حساب عميل جديد')
            con.commit()
            u = con.execute('SELECT * FROM users WHERE id=?',(id_,)).fetchone()
            raw_token = secrets.token_urlsafe(32)
            exp = (datetime.now(timezone.utc)+timedelta(days=SESSION_DAYS)).replace(microsecond=0).isoformat().replace('+00:00','Z')
            con.execute('INSERT INTO sessions VALUES(?,?,?)',(session_token_hash(raw_token),id_,exp))
            con.commit()
            return self.send_json({
                'ok': True,
                'user': user_dict(u),
                'recoveryCode': recovery_code
            }, extra_headers={'Set-Cookie':session_cookie_header(raw_token, SESSION_DAYS*86400)})
        if method == 'POST' and p == '/api/auth/recover':
            b = self.body_json()

            phone = normalize_phone(b.get('phone'))
            recovery_code = str(b.get('recoveryCode') or '').strip().upper()
            new_password = str(b.get('newPassword') or '')

            if not re.fullmatch(r'09\d{8}', phone):
                raise ValueError('رقم الهاتف غير صحيح.')

            if len(new_password) < 8:
                raise ValueError('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.')

            ip = self.client_address[0] if self.client_address else 'unknown'

            blocked, retry_after = login_rate_status(ip, phone)

            if blocked:
                return self.send_json(
                    {
                        'ok': False,
                        'message': 'محاولات استرجاع كثيرة. حاولي بعد قليل.'
                    },
                    429,
                    {'Retry-After': retry_after}
                )

            user = con.execute(
                'SELECT * FROM users WHERE phone=? AND status="active"',
                (phone,)
            ).fetchone()

            if (
                not user
                or not user['recovery_code_hash']
                or not verify_password(
                    recovery_code,
                    user['recovery_code_hash']
                )
            ):
                record_login_failure(ip, phone)

                return self.send_json(
                    {
                        'ok': False,
                        'message': 'رقم الهاتف أو رمز الاسترجاع غير صحيح.'
                    },
                    400
                )

            clear_login_pair(ip, phone)

            # تغيير كلمة المرور
            con.execute(
                '''
                UPDATE users
                SET password_hash=?,
                    updated_at=?
                WHERE id=?
                ''',
                (
                    hash_password(new_password),
                    now_iso(),
                    user['id']
                )
            )

            # إلغاء كل الجلسات القديمة
            con.execute(
                'DELETE FROM sessions WHERE user_id=?',
                (user['id'],)
            )

            # إنشاء Recovery Code جديد لأن القديم استُخدم
            new_recovery_code = generate_recovery_code()

            con.execute(
                '''
                UPDATE users
                SET recovery_code_hash=?,
                    updated_at=?
                WHERE id=?
                ''',
                (
                    hash_password(new_recovery_code),
                    now_iso(),
                    user['id']
                )
            )

            activity(
                con,
                user['id'],
                user['full_name'],
                'استرجاع الحساب وتغيير كلمة المرور'
            )

            con.commit()

            return self.send_json({
                'ok': True,
                'message': 'تم تغيير كلمة المرور بنجاح.',
                'recoveryCode': new_recovery_code
            }, extra_headers={'Set-Cookie':clear_session_cookie_header()})
        # products
        def save_product(payload, product_id=None):
            u=self.require(con,['admin'])
            if not u: return None
            name=str(payload.get('name') or '').strip()
            cat=str(payload.get('category') or '').strip()
            try:
                price=float(payload.get('price') if payload.get('price') not in (None,'') else 0)
            except Exception:
                raise ValueError('السعر غير صحيح.')
            try:
                raw_qty=float(payload.get('quantity') if payload.get('quantity') not in (None,'') else 0)
                if not raw_qty.is_integer(): raise ValueError
                qty=int(raw_qty)
            except Exception:
                raise ValueError('الكمية يجب أن تكون رقمًا صحيحًا.')
            if len(name)<2 or not cat: raise ValueError('اسم المنتج والتصنيف مطلوبان.')
            if price<0 or qty<0: raise ValueError('السعر والكمية لا يمكن أن يكونا سالبين.')
            ts=now_iso()
            frames=payload.get('frames') if isinstance(payload.get('frames'),list) else []
            if product_id is not None:
                old=con.execute('SELECT * FROM products WHERE id=?',(int(product_id),)).fetchone()
                if not old: raise ValueError('المنتج غير موجود.')
                if not frames: frames=jload(old['frames'],[])
                image=str(payload.get('image') or old['image'] or (frames[0] if frames else 'Images/ESPAN-logo-transparent.png'))
                con.execute('UPDATE products SET name=?,category=?,price=?,quantity=?,image=?,frames=?,description=?,featured=0,updated_at=? WHERE id=?',
                            (name,cat,price,qty,image,jdump(frames),str(payload.get('description') or ''),ts,int(product_id)))
                pid=int(product_id)
                activity(con,u['id'],u['full_name'],f'تعديل المنتج: {name}')
                if int(old['quantity'])<=0 and qty>0:
                    for fav in con.execute('SELECT user_id FROM favorites WHERE product_id=?',(pid,)):
                        notify(con,fav['user_id'],'عاد المنتج للمخزون',f'المنتج «{name}» الموجود في مفضلتك أصبح متوفرًا الآن.','stock')
            else:
                image=str(payload.get('image') or (frames[0] if frames else 'Images/ESPAN-logo-transparent.png'))
                cur=con.execute('INSERT INTO products(name,category,price,quantity,image,frames,description,featured,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                                (name,cat,price,qty,image,jdump(frames),str(payload.get('description') or ''),0,ts,ts))
                pid=cur.lastrowid
                activity(con,u['id'],u['full_name'],f'إضافة منتج: {name}')
            con.commit()
            row=con.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone()
            return self.send_json({'ok':True,'product':product_dict(con,row)})

        if method=='POST' and p=='/api/products':
            return save_product(self.body_json(), None)
        m=re.fullmatch(r'/api/products/(\d+)',p)
        if m and method=='PUT':
            return save_product(self.body_json(), int(m.group(1)))
        if m and method=='DELETE':
            u=self.require(con,['admin'])
            if not u:return
            r=con.execute('SELECT name FROM products WHERE id=?',(int(m.group(1)),)).fetchone()
            if not r: raise ValueError('المنتج غير موجود.')
            pid=int(m.group(1))
            # تفاصيل الطلبات القديمة تبقى محفوظة داخل order_items، لذلك يمكن حذف المنتج من الكتالوج بأمان.
            con.execute('DELETE FROM favorites WHERE product_id=?',(pid,))
            con.execute('DELETE FROM cart WHERE product_id=?',(pid,))
            con.execute('DELETE FROM reviews WHERE product_id=?',(pid,))
            con.execute('DELETE FROM offers WHERE product_id=?',(pid,))
            con.execute('DELETE FROM products WHERE id=?',(pid,))
            activity(con,u['id'],u['full_name'],f'حذف المنتج: {r["name"]}')
            con.commit()
            return self.send_json({'ok':True})
        # offers
        if method=='POST' and p=='/api/offers':
            u=self.require(con,['admin']);
            if not u:return
            b=self.body_json(); pid=int(b.get('productId') or 0); value=float(b.get('value') or 0); typ=str(b.get('type') or 'percentage'); title=str(b.get('title') or '').strip(); min_qty=max(1,int(b.get('minQuantity') or 1))
            product=con.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone()
            if not product: raise ValueError('اختاري منتجًا صحيحًا.')
            if not title or value<=0: raise ValueError('اسم العرض وقيمة الخصم مطلوبان.')
            if typ not in ('percentage','fixed_amount','fixed'): raise ValueError('نوع الخصم غير صحيح.')
            if typ=='percentage' and value>=100: raise ValueError('نسبة الخصم يجب أن تكون أقل من 100%.')
            if typ!='percentage' and value>=float(product['price']): raise ValueError('قيمة الخصم يجب أن تكون أقل من سعر المنتج الحالي.')
            if b.get('startDate') and b.get('endDate') and b['endDate']<b['startDate']: raise ValueError('تاريخ نهاية العرض يجب أن يكون بعد البداية.')
            id_=str(b.get('id') or uid('off')); existing=con.execute('SELECT 1 FROM offers WHERE id=?',(id_,)).fetchone()
            typ='fixed_amount' if typ=='fixed' else typ
            vals=(pid,typ,value,min_qty,str(b.get('startDate') or ''),str(b.get('endDate') or ''),1 if b.get('active',True) else 0,title)
            if existing: con.execute('UPDATE offers SET product_id=?,type=?,value=?,min_quantity=?,start_date=?,end_date=?,active=?,title=? WHERE id=?',(*vals,id_))
            else: con.execute('INSERT INTO offers(id,product_id,type,value,min_quantity,start_date,end_date,active,title,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(id_,*vals,now_iso()))
            condition=f'عند شراء {min_qty} قطعة أو أكثر' if min_qty>1 else 'بدون حد أدنى إضافي'
            activity(con,u['id'],u['full_name'],f'{"تعديل" if existing else "إضافة"} عرض: {title} — {condition}'); con.commit(); return self.send_json({'ok':True,'offer':offer_dict(con.execute('SELECT * FROM offers WHERE id=?',(id_,)).fetchone())})
        m=re.fullmatch(r'/api/offers/([^/]+)',p)
        if m and method=='DELETE':
            u=self.require(con,['admin']);
            if not u:return
            con.execute('DELETE FROM offers WHERE id=?',(m.group(1),)); activity(con,u['id'],u['full_name'],'حذف عرض'); con.commit(); return self.send_json({'ok':True})
        # users and profile
        if method=='POST' and p=='/api/users':
            u=self.require(con,['admin']);
            if not u:return
            b=self.body_json(); id_=str(b.get('id') or uid('usr')); name=str(b.get('full_name') or '').strip(); phone=normalize_phone(b.get('phone')); role=str(b.get('role') or 'customer'); status=str(b.get('status') or 'active')
            if len(name)<3 or not re.fullmatch(r'09\d{8}',phone): raise ValueError('الاسم أو رقم الهاتف غير صحيح.')
            if role not in ('admin','delivery','customer'): raise ValueError('نوع المستخدم غير صحيح.')
            existing=con.execute('SELECT * FROM users WHERE id=?',(id_,)).fetchone(); ts=now_iso()
            if id_=='admin-1' and status!='active': raise ValueError('لا يمكن إيقاف المدير الرئيسي.')
            recovery_code = ''
            if existing:
                password_changed = bool(b.get('password'))
                pw_hash=existing['password_hash'] if not password_changed else hash_password(str(b['password']))
                con.execute('UPDATE users SET full_name=?,phone=?,city=?,address=?,role=?,status=?,password_hash=?,updated_at=? WHERE id=?',
                            (name,phone,str(b.get('city') or ''),str(b.get('address') or ''),role,status,pw_hash,ts,id_))
                if password_changed or status != 'active':
                    con.execute('DELETE FROM sessions WHERE user_id=?',(id_,))
            else:
                pw=str(b.get('password') or '')
                if len(pw)<8: raise ValueError('كلمة المرور مطلوبة وبحد أدنى 8 أحرف.')
                recovery_code = generate_recovery_code()
                con.execute(
                    'INSERT INTO users(id,full_name,phone,city,address,role,status,password_hash,recovery_code_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                    (id_,name,phone,str(b.get('city') or ''),str(b.get('address') or ''),role,status,hash_password(pw),hash_password(recovery_code),ts,ts)
                )
            activity(con,u['id'],u['full_name'],f'حفظ مستخدم: {name} ({role})')
            con.commit()
            response={'ok':True,'user':user_dict(con.execute('SELECT * FROM users WHERE id=?',(id_,)).fetchone())}
            if recovery_code: response['recoveryCode']=recovery_code
            return self.send_json(response)
        m=re.fullmatch(r'/api/users/([^/]+)/profile',p)
        if m and method=='PATCH':
            u=self.require(con,None);
            if not u:return
            target=m.group(1)
            if u['id']!=target and u['role']!='admin': return self.send_json({'ok':False,'message':'ليس لديك صلاحية.'},403)
            b=self.body_json(); row=con.execute('SELECT * FROM users WHERE id=?',(target,)).fetchone()
            if not row: raise ValueError('المستخدم غير موجود.')
            if u['role']=='admin' and u['id']!=target and row['role']!='admin':
                return self.send_json({'ok':False,'message':'تعديل البيانات من لوحة الإدارة متاح لحسابات المديرين فقط.'},403)
            if not verify_password(str(b.get('currentPassword') or ''),row['password_hash']): return self.send_json({'ok':False,'message':'كلمة المرور الحالية غير صحيحة.'},400)
            name=str(b.get('full_name') or row['full_name']).strip(); phone=normalize_phone(b.get('phone') or row['phone']); pw=row['password_hash']
            password_changed = bool(b.get('newPassword'))
            if password_changed:
                if len(str(b['newPassword']))<8: raise ValueError('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.')
                pw=hash_password(str(b['newPassword']))
            con.execute('UPDATE users SET full_name=?,phone=?,city=?,address=?,password_hash=?,updated_at=? WHERE id=?',(name,phone,str(b.get('city') or ''),str(b.get('address') or ''),pw,now_iso(),target))
            extra_headers = None
            if password_changed:
                con.execute('DELETE FROM sessions WHERE user_id=?',(target,))
                if u['id'] == target:
                    raw_token = secrets.token_urlsafe(32)
                    exp = (datetime.now(timezone.utc)+timedelta(days=SESSION_DAYS)).replace(microsecond=0).isoformat().replace('+00:00','Z')
                    con.execute('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)',(session_token_hash(raw_token),target,exp))
                    extra_headers={'Set-Cookie':session_cookie_header(raw_token, SESSION_DAYS*86400)}
            activity(con,u['id'],u['full_name'],'تعديل بيانات الحساب')
            con.commit()
            return self.send_json({'ok':True,'user':user_dict(con.execute('SELECT * FROM users WHERE id=?',(target,)).fetchone())}, extra_headers=extra_headers)
        m=re.fullmatch(r'/api/users/([^/]+)',p)
        if m and method=='DELETE':
            u=self.require(con,['admin'])
            if not u:return
            target=m.group(1)
            if target=='admin-1': raise ValueError('لا يمكن حذف المدير الرئيسي للنظام.')
            if target==u['id']: raise ValueError('لا يمكنك حذف حسابك أثناء تسجيل الدخول.')
            if con.execute('SELECT 1 FROM orders WHERE user_id=? OR delivery_id=? LIMIT 1',(target,target)).fetchone(): raise ValueError('الحساب مرتبط بطلبات. أوقفيه بدلًا من حذفه.')
            row=con.execute('SELECT full_name FROM users WHERE id=?',(target,)).fetchone()
            if not row: raise ValueError('المستخدم غير موجود.')
            con.execute('DELETE FROM users WHERE id=?',(target,))
            activity(con,u['id'],u['full_name'],f'حذف مستخدم: {row["full_name"]}')
            con.commit()
            return self.send_json({'ok':True})
        # direct single-product order (uses current active offer price)
        if method=='POST' and p=='/api/orders':
            u=self.require(con,['customer']);
            if not u:return
            b=self.body_json(); pid=int(b.get('productId') or 0); qty=max(1,int(b.get('quantity') or 1))
            pr=con.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone()
            if not pr or qty>int(pr['quantity']): raise ValueError('الكمية المطلوبة غير متوفرة.')
            unit=round(price_for(con,pid,pr['price'],qty),2); total=round(unit*qty,2); oid=uid('ORD').upper(); ts=now_iso()
            timeline=[{'status':'طلب جديد','at':ts,'by':'العميل'}]
            con.execute('INSERT INTO orders(id,user_id,customer_name,customer_phone,address,total,status,payment_method,notes,timeline,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                        (oid,u['id'],u['full_name'],u['phone'],str(b.get('address') or u['address'] or ''),total,'طلب جديد','نقدًا',str(b.get('notes') or ''),jdump(timeline),ts,ts))
            con.execute('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?)',(oid,pid,pr['name'],qty,unit,total))
            con.execute('UPDATE products SET quantity=quantity-?,updated_at=? WHERE id=?',(qty,ts,pid))
            notify_role(con,'admin','طلب جديد',f'وصل طلب جديد {oid} بقيمة {total} د.ل.','order')
            activity(con,u['id'],u['full_name'],f'إنشاء الطلب {oid}'); con.commit()
            return self.send_json({'ok':True,'order':order_dict(con,con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())})
        # favorites
        m=re.fullmatch(r'/api/favorites/(\d+)/toggle',p)
        if m and method=='POST':
            u=self.require(con,['customer']);
            if not u:return
            pid=int(m.group(1)); exists=con.execute('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?',(u['id'],pid)).fetchone()
            if exists: con.execute('DELETE FROM favorites WHERE user_id=? AND product_id=?',(u['id'],pid)); favorite=False
            else: con.execute('INSERT INTO favorites VALUES(?,?)',(u['id'],pid)); favorite=True
            con.commit(); return self.send_json({'ok':True,'favorite':favorite})
        # cart
        if method=='POST' and p=='/api/cart/items':
            u=self.require(con,['customer']);
            if not u:return
            b=self.body_json(); pid=int(b.get('productId') or 0); qty=max(1,int(b.get('quantity') or 1)); pr=con.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone()
            if not pr or pr['quantity']<=0: raise ValueError('المنتج غير متوفر.')
            old=con.execute('SELECT quantity FROM cart WHERE user_id=? AND product_id=?',(u['id'],pid)).fetchone(); new=min(pr['quantity'],qty+(old['quantity'] if old else 0))
            con.execute('INSERT INTO cart(user_id,product_id,quantity) VALUES(?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity',(u['id'],pid,new)); con.commit(); return self.send_json({'ok':True,'quantity':new})
        m=re.fullmatch(r'/api/cart/items/(\d+)',p)
        if m and method=='PATCH':
            u=self.require(con,['customer']);
            if not u:return
            b=self.body_json(); pid=int(m.group(1)); qty=int(b.get('quantity') or 1); pr=con.execute('SELECT quantity FROM products WHERE id=?',(pid,)).fetchone()
            if not pr: raise ValueError('المنتج غير موجود.')
            qty=max(1,min(qty,int(pr['quantity']))); con.execute('UPDATE cart SET quantity=? WHERE user_id=? AND product_id=?',(qty,u['id'],pid)); con.commit(); return self.send_json({'ok':True,'quantity':qty})
        if m and method=='DELETE':
            u=self.require(con,['customer']);
            if not u:return
            con.execute('DELETE FROM cart WHERE user_id=? AND product_id=?',(u['id'],int(m.group(1)))); con.commit(); return self.send_json({'ok':True})
        if method=='POST' and p=='/api/cart/checkout':
            u=self.require(con,['customer']);
            if not u:return
            b=self.body_json(); rows=list(con.execute('''SELECT c.product_id,c.quantity,p.* FROM cart c JOIN products p ON p.id=c.product_id WHERE c.user_id=?''',(u['id'],)))
            if not rows: raise ValueError('السلة فارغة.')
            total=0; prepared=[]
            # اقرأ كمية السلة وكمية المخزون كل واحدة بشكل مستقل.
            for c in con.execute('SELECT product_id,quantity FROM cart WHERE user_id=?',(u['id'],)):
                pr=con.execute('SELECT * FROM products WHERE id=?',(c['product_id'],)).fetchone(); q=int(c['quantity'])
                if not pr or q>int(pr['quantity']): raise ValueError(f'الكمية المتاحة من {pr["name"] if pr else "المنتج"} لا تكفي.')
                unit=round(price_for(con,pr['id'],pr['price'],q),2); line=round(unit*q,2); total+=line; prepared.append((pr,q,unit,line))
            oid=uid('ORD').upper(); ts=now_iso(); timeline=[{'status':'طلب جديد','at':ts,'by':'العميل'}]
            con.execute('INSERT INTO orders(id,user_id,customer_name,customer_phone,address,total,status,payment_method,notes,timeline,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                        (oid,u['id'],u['full_name'],u['phone'],str(b.get('address') or u['address'] or ''),round(total,2),'طلب جديد','نقدًا',str(b.get('notes') or ''),jdump(timeline),ts,ts))
            for pr,q,unit,line in prepared:
                con.execute('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?)',(oid,pr['id'],pr['name'],q,unit,line))
                con.execute('UPDATE products SET quantity=quantity-?,updated_at=? WHERE id=?',(q,ts,pr['id']))
            con.execute('DELETE FROM cart WHERE user_id=?',(u['id'],)); notify_role(con,'admin','طلب جديد',f'وصل طلب جديد {oid} بقيمة {round(total,2)} د.ل.','order'); activity(con,u['id'],u['full_name'],f'إنشاء الطلب {oid}'); con.commit()
            return self.send_json({'ok':True,'order':order_dict(con,con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())})
        # orders admin/delivery/customer
        m=re.fullmatch(r'/api/orders/([^/]+)',p)
        if m and method=='PATCH':
            u=self.require(con,['admin','delivery']);
            if not u:return
            oid=m.group(1); row=con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone();
            if not row: raise ValueError('الطلب غير موجود.')
            b=self.body_json(); status=str(b.get('status') or row['status'])
            if status not in ORDER_STATUSES: raise ValueError('حالة الطلب غير صحيحة.')
            if u['role']=='delivery':
                if row['delivery_id']!=u['id']: return self.send_json({'ok':False,'message':'هذا الطلب غير معين لك.'},403)
                allowed={'جاهز للتوصيل':'خرج للتوصيل','خرج للتوصيل':'تم التسليم'}
                if status!=row['status'] and allowed.get(row['status'])!=status:
                    return self.send_json({'ok':False,'message':'المندوب يمكنه فقط بدء التوصيل ثم تأكيد التسليم.'},403)
            old=row['status']
            # الإدارة تستطيع إلغاء إسناد المندوب من نفس PATCH الذي تستخدمه الواجهة.
            if u['role']=='admin' and 'deliveryId' in b and not str(b.get('deliveryId') or ''):
                con.execute('UPDATE orders SET delivery_id="",delivery_name="",updated_at=? WHERE id=?',(now_iso(),oid))
            if status!=old:
                timeline=jload(row['timeline'],[]); timeline.append({'status':status,'at':now_iso(),'by':u['full_name']})
                con.execute('UPDATE orders SET status=?,timeline=?,updated_at=? WHERE id=?',(status,jdump(timeline),now_iso(),oid))
                if old=='طلب جديد' and status!='طلب جديد': notify(con,row['user_id'],'تم قبول طلبك',f'تم قبول الطلب {oid} وحالته الآن: {status}.','order')
                if status=='جاهز للتوصيل' and row['delivery_id']:
                    notify(con,row['delivery_id'],'الطلب جاهز للتوصيل',f'الطلب {oid} المسند لك أصبح جاهزًا للتوصيل.','delivery')
                if status=='تم التسليم': notify(con,row['user_id'],'تم تسليم طلبك',f'تم تسليم الطلب {oid} بنجاح. يمكنك الآن تقييم المنتجات.','order'); notify_role(con,'admin','تم تسليم طلب',f'المندوب أنهى تسليم الطلب {oid}.','delivery')
                activity(con,u['id'],u['full_name'],f'تغيير حالة الطلب {oid}: {old} ← {status}')
            con.commit(); return self.send_json({'ok':True,'order':order_dict(con,con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())})
        m=re.fullmatch(r'/api/orders/([^/]+)/assign',p)
        if m and method=='POST':
            u=self.require(con,['admin']);
            if not u:return
            b=self.body_json(); did=str(b.get('deliveryId') or ''); d=con.execute('SELECT * FROM users WHERE id=? AND role="delivery" AND status="active"',(did,)).fetchone()
            if not d: raise ValueError('اختاري مندوب توصيل نشط.')
            oid=m.group(1); row=con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone();
            if not row: raise ValueError('الطلب غير موجود.')
            if row['status']=='ملغي': raise ValueError('لا يمكن تعيين مندوب لطلب ملغي.')
            con.execute('UPDATE orders SET delivery_id=?,delivery_name=?,updated_at=? WHERE id=?',(did,d['full_name'],now_iso(),oid)); notify(con,did,'طلب توصيل جديد',f'تم تعيين الطلب {oid} لك. العميل: {row["customer_name"]}.','delivery'); activity(con,u['id'],u['full_name'],f'تعيين {d["full_name"]} للطلب {oid}'); con.commit(); return self.send_json({'ok':True,'order':order_dict(con,con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())})
        m=re.fullmatch(r'/api/orders/([^/]+)/customer',p)
        if m and method=='PUT':
            u=self.require(con,['customer']);
            if not u:return
            oid=m.group(1); row=con.execute('SELECT * FROM orders WHERE id=? AND user_id=?',(oid,u['id'])).fetchone()
            if not row or row['status']!='طلب جديد': raise ValueError('لا يمكن تعديل الطلب بعد تأكيد الإدارة.')
            b=self.body_json(); wanted={int(x['productId']):max(0,int(x['quantity'])) for x in b.get('items',[]) if x.get('productId')}
            olditems=list(con.execute('SELECT * FROM order_items WHERE order_id=?',(oid,)))
            # return all old stock first
            for it in olditems: con.execute('UPDATE products SET quantity=quantity+? WHERE id=?',(it['quantity'],it['product_id']))
            con.execute('DELETE FROM order_items WHERE order_id=?',(oid,)); total=0; count=0
            for pid,q in wanted.items():
                if q<=0: continue
                pr=con.execute('SELECT * FROM products WHERE id=?',(pid,)).fetchone()
                if not pr or q>pr['quantity']: raise ValueError('إحدى الكميات المطلوبة غير متوفرة.')
                unit=round(price_for(con,pid,pr['price'],q),2); line=round(unit*q,2); total+=line; count+=1
                con.execute('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?)',(oid,pid,pr['name'],q,unit,line)); con.execute('UPDATE products SET quantity=quantity-? WHERE id=?',(q,pid))
            if count==0: raise ValueError('يجب أن يبقى منتج واحد على الأقل في الطلب.')
            con.execute('UPDATE orders SET total=?,address=?,notes=?,updated_at=? WHERE id=?',(round(total,2),str(b.get('address') or row['address']),str(b.get('notes') or ''),now_iso(),oid)); activity(con,u['id'],u['full_name'],f'تعديل الطلب {oid} قبل التأكيد'); con.commit(); return self.send_json({'ok':True,'order':order_dict(con,con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())})
        if m and method=='DELETE':
            u=self.require(con,['customer']);
            if not u:return
            oid=m.group(1); row=con.execute('SELECT * FROM orders WHERE id=? AND user_id=?',(oid,u['id'])).fetchone()
            if not row or row['status']!='طلب جديد': raise ValueError('لا يمكن إلغاء الطلب بعد تأكيد الإدارة.')
            for it in con.execute('SELECT * FROM order_items WHERE order_id=?',(oid,)): con.execute('UPDATE products SET quantity=quantity+? WHERE id=?',(it['quantity'],it['product_id']))
            con.execute('UPDATE orders SET status="ملغي",updated_at=? WHERE id=?',(now_iso(),oid)); notify_role(con,'admin','طلب ملغي',f'ألغى العميل الطلب {oid} قبل التأكيد.','order'); activity(con,u['id'],u['full_name'],f'إلغاء الطلب {oid}'); con.commit(); return self.send_json({'ok':True})
        m=re.fullmatch(r'/api/orders/([^/]+)/reorder',p)
        if m and method=='POST':
            u=self.require(con,['customer']);
            if not u:return
            old=con.execute('SELECT * FROM orders WHERE id=? AND user_id=?',(m.group(1),u['id'])).fetchone();
            if not old: raise ValueError('الطلب غير موجود.')
            prepared=[]; total=0
            for it in con.execute('SELECT * FROM order_items WHERE order_id=?',(old['id'],)):
                pr=con.execute('SELECT * FROM products WHERE id=?',(it['product_id'],)).fetchone()
                if not pr or pr['quantity']<=0: continue
                q=min(int(it['quantity']),int(pr['quantity']))
                if q<=0: continue
                unit=round(price_for(con,pr['id'],pr['price'],q),2); line=round(unit*q,2)
                prepared.append((pr,q,unit,line)); total+=line
            if not prepared: raise ValueError('منتجات الطلب السابق غير متوفرة حاليًا.')
            oid=uid('ORD').upper(); ts=now_iso(); timeline=[{'status':'طلب جديد','at':ts,'by':'العميل','note':f'إعادة الطلب {old["id"]}'}]
            con.execute('INSERT INTO orders(id,user_id,customer_name,customer_phone,address,total,status,payment_method,notes,timeline,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                        (oid,u['id'],u['full_name'],u['phone'],old['address'],round(total,2),'طلب جديد','نقدًا',old['notes'],jdump(timeline),ts,ts))
            for pr,q,unit,line in prepared:
                con.execute('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?)',(oid,pr['id'],pr['name'],q,unit,line))
                con.execute('UPDATE products SET quantity=quantity-?,updated_at=? WHERE id=?',(q,ts,pr['id']))
            notify_role(con,'admin','طلب معاد',f'أنشأ العميل الطلب {oid} من طلب سابق.','order'); activity(con,u['id'],u['full_name'],f'إعادة الطلب {old["id"]} كطلب جديد {oid}'); con.commit()
            return self.send_json({'ok':True,'order':order_dict(con,con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())})
        m=re.fullmatch(r'/api/orders/([^/]+)/cash',p)
        if m and method=='PATCH':
            u=self.require(con,['admin','delivery']);
            if not u:return
            oid=m.group(1); row=con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone();
            if not row or row['status']!='تم التسليم': raise ValueError('التحصيل متاح بعد التسليم فقط.')
            b=self.body_json(); ts=now_iso()
            if u['role']=='delivery':
                if row['delivery_id']!=u['id']: return self.send_json({'ok':False,'message':'الطلب غير معين لك.'},403)
                handed=1 if b.get('handedOver',True) else 0; con.execute('UPDATE orders SET cash_handed_over=?,cash_handed_at=? WHERE id=?',(handed,ts if handed else '',oid)); notify_role(con,'admin','تحصيل بانتظار التأكيد',f'{u["full_name"]} سلّم مبلغ الطلب {oid} للإدارة.','cash')
            else:
                confirmed=1 if b.get('confirmed',True) else 0
                if confirmed and not row['cash_handed_over']: raise ValueError('يجب أن يسجل المندوب تسليم المبلغ أولًا.')
                con.execute('UPDATE orders SET cash_confirmed=?,cash_confirmed_at=? WHERE id=?',(confirmed,ts if confirmed else '',oid))
            activity(con,u['id'],u['full_name'],f'تحديث تحصيل الطلب {oid}'); con.commit(); return self.send_json({'ok':True,'order':order_dict(con,con.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())})
        # reviews
        if method=='POST' and p=='/api/reviews':
            u=self.require(con,['customer']);
            if not u:return
            b=self.body_json(); oid=str(b.get('orderId') or ''); pid=int(b.get('productId') or 0); rating=int(b.get('rating') or 0)
            order=con.execute('SELECT * FROM orders WHERE id=? AND user_id=? AND status="تم التسليم"',(oid,u['id'])).fetchone()
            if not order: raise ValueError('يمكن التقييم بعد تسليم الطلب فقط.')
            if not con.execute('SELECT 1 FROM order_items WHERE order_id=? AND product_id=?',(oid,pid)).fetchone(): raise ValueError('المنتج غير موجود في هذا الطلب.')
            if rating<1 or rating>5: raise ValueError('التقييم يجب أن يكون من 1 إلى 5.')
            try: con.execute('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)',(uid('rev'),u['id'],oid,pid,rating,str(b.get('comment') or ''),now_iso()))
            except sqlite3.IntegrityError: raise ValueError('تم تقييم هذا المنتج في الطلب مسبقًا.')
            con.commit(); return self.send_json({'ok':True})
        # complaints
        if method=='POST' and p=='/api/complaints':
            u=self.require(con,['customer']);
            if not u:return
            b=self.body_json(); oid=str(b.get('orderId') or ''); pid=int(b.get('productId') or 0); message=str(b.get('message') or '').strip()
            if len(message)<3: raise ValueError('اكتبي تفاصيل الشكوى.')
            order=con.execute('SELECT 1 FROM orders WHERE id=? AND user_id=? AND status="تم التسليم"',(oid,u['id'])).fetchone()
            if not order: raise ValueError('يمكن إرسال شكوى بعد استلام الطلب.')
            item=con.execute('SELECT product_name FROM order_items WHERE order_id=? AND product_id=?',(oid,pid)).fetchone()
            if not item: raise ValueError('اختاري منتجًا موجودًا في الطلب.')
            if con.execute('SELECT 1 FROM complaints WHERE user_id=? AND product_id=?',(u['id'],pid)).fetchone():
                raise ValueError('تم إرسال شكوى لهذا المنتج مسبقًا. يمكن إرسال شكوى واحدة فقط لكل منتج.')
            id_=uid('cmp'); ts=now_iso()
            con.execute('INSERT INTO complaints(id,user_id,order_id,customer_name,message,status,reply,created_at,updated_at,product_id,product_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                        (id_,u['id'],oid,u['full_name'],message,'جديدة','',ts,ts,pid,item['product_name']))
            notify_role(con,'admin','شكوى جديدة',f'وصلت شكوى جديدة بخصوص {item["product_name"]} في الطلب {oid}.','complaint')
            con.commit(); return self.send_json({'ok':True,'id':id_})
        m=re.fullmatch(r'/api/complaints/([^/]+)',p)
        if m and method=='PATCH':
            u=self.require(con,['admin']);
            if not u:return
            b=self.body_json(); status=str(b.get('status') or 'جديدة'); reply=str(b.get('reply') or '').strip()
            if status not in ('جديدة','قيد المعالجة','مغلقة'): raise ValueError('حالة الشكوى غير صحيحة.')
            con.execute('UPDATE complaints SET status=?,reply=?,updated_at=? WHERE id=?',(status,reply,now_iso(),m.group(1)))
            c=con.execute('SELECT * FROM complaints WHERE id=?',(m.group(1),)).fetchone()
            if not c: raise ValueError('الشكوى غير موجودة.')
            if reply: notify(con,c['user_id'],'رد على الشكوى',f'تم الرد على شكواك الخاصة بـ {c["product_name"] or c["order_id"]}.','complaint')
            activity(con,u['id'],u['full_name'],'تحديث شكوى'); con.commit(); return self.send_json({'ok':True})
        # notifications
        m=re.fullmatch(r'/api/notifications/([^/]+)',p)
        if m and method=='PATCH':
            u=self.require(con,None);
            if not u:return
            b=self.body_json(); con.execute('UPDATE notifications SET is_read=? WHERE id=? AND user_id=?',(1 if b.get('read',True) else 0,m.group(1),u['id'])); con.commit(); return self.send_json({'ok':True})
        if method=='POST' and p=='/api/notifications/read-all':
            u=self.require(con,None);
            if not u:return
            con.execute('UPDATE notifications SET is_read=1 WHERE user_id=?',(u['id'],)); con.commit(); return self.send_json({'ok':True})
        # reports
        if method=='GET' and p=='/api/admin/reports':
            u=self.require(con,['admin']);
            if not u:return
            delivered=list(con.execute("SELECT * FROM orders WHERE status='تم التسليم'")); today=datetime.now().date();
            def date_of(s):
                try:return datetime.fromisoformat(s.replace('Z','+00:00')).date()
                except:return today
            today_sales=sum(float(r['total']) for r in delivered if date_of(r['updated_at'])==today)
            month_sales=sum(float(r['total']) for r in delivered if date_of(r['updated_at']).year==today.year and date_of(r['updated_at']).month==today.month)
            year_sales=sum(float(r['total']) for r in delivered if date_of(r['updated_at']).year==today.year)
            avg=(sum(float(r['total']) for r in delivered)/len(delivered)) if delivered else 0
            top_products=[dict(r) for r in con.execute('''SELECT oi.product_name name,SUM(oi.quantity) quantity,SUM(oi.line_total) sales FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='تم التسليم' GROUP BY oi.product_id ORDER BY quantity DESC LIMIT 5''')]
            top_customers=[dict(r) for r in con.execute('''SELECT customer_name name,COUNT(*) orders,SUM(total) sales FROM orders WHERE status='تم التسليم' GROUP BY user_id ORDER BY sales DESC LIMIT 5''')]
            by_status={r['status']:r['c'] for r in con.execute('SELECT status,COUNT(*) c FROM orders GROUP BY status')}
            reports={'todayRevenue':round(today_sales,2),'monthRevenue':round(month_sales,2),'yearRevenue':round(year_sales,2),'averageOrder':round(avg,2),
                     'totalOrders':sum(by_status.values()),'deliveredOrders':by_status.get('تم التسليم',0),'cancelledOrders':by_status.get('ملغي',0),
                     'topProducts':[{'name':x['name'],'quantity':x['quantity'],'revenue':x['sales']} for x in top_products],
                     'topCustomers':[{'name':x['name'],'ordersCount':x['orders'],'totalSpent':x['sales']} for x in top_customers],
                     'byStatus':[{'status':k,'count':v} for k,v in by_status.items()]}
            return self.send_json({'ok':True,'reports':reports})
        if method=='GET' and p=='/api/admin/export':
            u=self.require(con,['admin']);
            if not u:return
            return self.send_json({'ok':True,'exportedAt':now_iso(),'data':bootstrap(con,u)})
        if method=='POST' and p=='/api/admin/import':
            u=self.require(con,['admin']);
            if not u:return
            return self.send_json({'ok':False,'message':'الاستيراد المباشر معطل في النسخة الآمنة. استخدمي النسخ الاحتياطي للاسترجاع اليدوي.'},400)
        # compatibility no-op push endpoints
        if method=='GET' and p=='/api/push/public-key': return self.send_json({'ok':True,'publicKey':''})
        if method in ('POST','DELETE') and p in ('/api/push/subscribe','/api/push/unsubscribe'): return self.send_json({'ok':True})
        if method=='PATCH' and p=='/api/settings':
            u=self.require(con,['admin']);
            if not u:return
            b=self.body_json(); th=max(1,int(b.get('lowStockThreshold') or 3)); con.execute('UPDATE settings SET low_stock_threshold=? WHERE id=1',(th,)); con.commit(); return self.send_json({'ok':True})
        return self.send_json({'ok':False,'message':'المسار غير موجود.'},404)

def main():
    init_db(False)
    preferred = PORT
    httpd = None
    actual_port = None
    # محليًا يمكن الانتقال تلقائيًا لمنفذ آخر. في Production استخدمي ESPAN_STRICT_PORT=1.
    candidates = [preferred] if STRICT_PORT else range(preferred, preferred + 30)
    for candidate in candidates:
        try:
            httpd = ThreadingHTTPServer((BIND_HOST, candidate), Handler)
            actual_port = candidate
            break
        except OSError as exc:
            if getattr(exc, 'errno', None) != 98:
                raise
    if httpd is None:
        raise RuntimeError('تعذر إيجاد منفذ متاح لتشغيل ESPAN.')
    try:
        (ROOT / '.espan_port').write_text(str(actual_port), encoding='utf-8')
    except Exception:
        pass
    print('='*60, flush=True)
    print('ESPAN Final Client Release', flush=True)
    print(f'افتحي: http://localhost:{actual_port}/auth.html', flush=True)
    if actual_port != preferred:
        print(f'ملاحظة: المنفذ {preferred} كان مستخدمًا، لذلك تم التشغيل تلقائيًا على {actual_port}.', flush=True)
    print('='*60, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        try:
            (ROOT / '.espan_port').unlink(missing_ok=True)
        except Exception:
            pass
if __name__=='__main__': main()
