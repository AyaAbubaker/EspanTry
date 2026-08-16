# ESPAN — النسخة النهائية للعميل

## التشغيل المحلي

```bash
chmod +x start.sh
./start.sh
```

ثم افتح الرابط الذي يظهر في Terminal.

## حساب المدير

تم تجهيز المدير الرئيسي بالرقم المتفق عليه. لا يتم طباعة كلمة المرور أو Recovery Code داخل Terminal أو ملفات التعليمات.

## النشر على الإنترنت

استخدم `start-production.sh` خلف HTTPS Reverse Proxy. يوجد مثال في `Caddyfile.example` وتعليمات الأمان في `SECURITY.md`.

## النسخ الاحتياطي

```bash
./backup.sh
```

## تغيير/إعادة تجهيز حساب المدير من الخادم

```bash
python3 manage-admin.py
```

سيطلب كلمة المرور بشكل مخفي ويعطي Recovery Code مرة واحدة.

## حماية النسخة

- Session داخل HttpOnly Cookie ولا يوجد Token تسجيل دخول في localStorage.
- Hash للجلسات داخل SQLite بدل حفظ Token الصريح.
- PBKDF2-SHA256 بـ 600,000 دورة للحسابات الجديدة والنسخة المرفقة.
- SameSite=Strict، ودعم Secure Cookie + HSTS في وضع Production.
- Security Headers وCSP وحماية من الطلبات ذات Origin مختلف.
- Rate Limit للدخول والتسجيل والاسترجاع.
- تغيير/استرجاع كلمة المرور يلغي الجلسات السابقة.
- صلاحيات Admin / Customer / Delivery مفروضة من Backend.
- Reset Demo والاستيراد المباشر معطلان.
