#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import getpass, re, sqlite3
import server

server.init_db(False)
phone = server.normalize_phone(input('رقم هاتف المدير: ').strip())
if not re.fullmatch(r'09\d{8}', phone):
    raise SystemExit('رقم الهاتف غير صحيح.')
password = getpass.getpass('كلمة المرور الجديدة (8 أحرف على الأقل): ')
confirm = getpass.getpass('تأكيد كلمة المرور: ')
if password != confirm:
    raise SystemExit('كلمتا المرور غير متطابقتين.')
if len(password) < 8:
    raise SystemExit('كلمة المرور قصيرة.')

recovery = server.generate_recovery_code()
con = server.db()
row = con.execute("SELECT * FROM users WHERE id='admin-1'").fetchone()
ts = server.now_iso()
if row:
    con.execute("UPDATE users SET phone=?, role='admin', status='active', password_hash=?, recovery_code_hash=?, updated_at=? WHERE id='admin-1'",
                (phone, server.hash_password(password), server.hash_password(recovery), ts))
else:
    con.execute("INSERT INTO users(id,full_name,phone,city,address,role,status,password_hash,recovery_code_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                ('admin-1','مدير ESPAN',phone,'','','admin','active',server.hash_password(password),server.hash_password(recovery),ts,ts))
con.execute("DELETE FROM sessions WHERE user_id='admin-1'")
con.commit(); con.close()
print('\n✅ تم تجهيز حساب المدير.')
print('Recovery Code:', recovery)
print('احفظي الرمز في مكان آمن؛ لن يتم حفظه كنص صريح في قاعدة البيانات.')
