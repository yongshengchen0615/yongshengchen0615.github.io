const express = require('express');
const Database = require("@replit/database");
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database();

app.use(express.json());
app.use(cors());

// 提供前台頁面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend.html'));
});

// 提供後台頁面
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'backend.html'));
});

// 取得所有個人資料
app.get('/api/get_profiles', async (req, res) => {
    let keys = await db.list();
    let profiles = [];
    
    for (let key of keys) {
        let data = await db.get(key);
        profiles.push(data);
    }

    res.json(profiles);
});

// 新增個人資料
app.post('/api/add_profile', async (req, res) => {
    let { name, age, job } = req.body;
    let key = `profile_${Date.now()}`;
    
    await db.set(key, { name, age, job });
    res.json({ message: "個人資料已新增成功！" });
});

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`伺服器運行中，訪問 http://localhost:${PORT}`));
