        // ==========================================================================
        // 角色卡编写器：PNG 写入
        //   PNG 里角色卡是塞在一个 tEXt 数据块里的（keyword = chara / ccv3，
        //   内容是 base64(UTF-8 JSON)）。这里自己算 CRC32 拼块，不引第三方库
        // ==========================================================================

        const ST_CRC_TABLE = (() => {
            const t = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c >>> 0;
            }
            return t;
        })();

        function stCrc32(bytes) {
            let c = 0xffffffff;
            for (let i = 0; i < bytes.length; i++) c = ST_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
            return (c ^ 0xffffffff) >>> 0;
        }

        function stPngChunk(type, data) {
            const out = new Uint8Array(12 + data.length);
            const dv = new DataView(out.buffer);
            dv.setUint32(0, data.length);
            for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i) & 0xff;
            out.set(data, 8);
            dv.setUint32(8 + data.length, stCrc32(out.subarray(4, 8 + data.length)));
            return out;
        }

        // UTF-8 字符串 → base64。分块喂给 fromCharCode，免得大卡把调用栈撑爆
        function stB64Utf8(str) {
            const bytes = new TextEncoder().encode(str);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            return btoa(bin);
        }

        function stPngTextChunk(keyword, jsonText) {
            const b64 = stB64Utf8(jsonText);
            const kw = new Uint8Array(keyword.length);
            for (let i = 0; i < keyword.length; i++) kw[i] = keyword.charCodeAt(i) & 0xff;
            const data = new Uint8Array(kw.length + 1 + b64.length);
            data.set(kw, 0);
            data[kw.length] = 0;
            for (let i = 0; i < b64.length; i++) data[kw.length + 1 + i] = b64.charCodeAt(i) & 0xff;
            return stPngChunk('tEXt', data);
        }

        // 把卡数据块塞进 PNG：先扔掉旧的 chara / ccv3 / ccv2，再在 IEND 之前插进去
        // （和 ST 的 writeCharacterCardToPng 一个位置）
        function stInjectCardChunk(pngBytes, keyword, jsonText) {
            const u8 = new Uint8Array(pngBytes);
            if (!isPngBuffer(u8)) throw new Error('不是合法的 PNG（文件头签名不对）');
            const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
            const parts = [u8.subarray(0, 8)];
            let off = 8;
            let inserted = false;
            let sawIend = false;
            while (off + 8 <= u8.length) {
                const len = dv.getUint32(off);
                const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
                const dataStart = off + 8;
                const dataEnd = dataStart + len;
                if (dataEnd + 4 > u8.length) break;
                const whole = u8.subarray(off, dataEnd + 4);
                if (type === 'IEND') {
                    if (!inserted) { parts.push(stPngTextChunk(keyword, jsonText)); inserted = true; }
                    parts.push(whole);
                    sawIend = true;
                    break;
                }
                let drop = false;
                if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
                    let kEnd = dataStart;
                    while (kEnd < dataEnd && u8[kEnd] !== 0) kEnd++;
                    const kw = bytesToLatin1(u8.subarray(dataStart, kEnd));
                    if (kw === 'chara' || kw === 'ccv3' || kw === 'ccv2') drop = true;
                }
                if (!drop) parts.push(whole);
                off = dataEnd + 4;
            }
            // 理论上一定会有 IEND；真没有的话也别丢数据块
            if (!inserted) parts.push(stPngTextChunk(keyword, jsonText));
            let total = 0;
            parts.forEach(p => { total += p.length; });
            const out = new Uint8Array(total);
            let p = 0;
            parts.forEach(part => { out.set(part, p); p += part.length; });
            return out;
        }

        function stDataUrlToBytes(dataUrl) {
            const comma = String(dataUrl).indexOf(',');
            if (comma < 0) throw new Error('头像不是合法的 data URL');
            const meta = dataUrl.slice(0, comma);
            const body = dataUrl.slice(comma + 1);
            if (/;base64/i.test(meta)) {
                const bin = atob(body.replace(/\s+/g, ''));
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                return arr;
            }
            return new TextEncoder().encode(decodeURIComponent(body));
        }

        function stMimeOfDataUrl(dataUrl) {
            const m = /^data:([^;,]+)/i.exec(String(dataUrl || ''));
            return m ? m[1].toLowerCase() : '';
        }

        function stLoadImage(src) {
            return new Promise((res, rej) => {
                const img = new Image();
                img.onload = () => res(img);
                img.onerror = () => rej(new Error('图片解码失败'));
                img.src = src;
            });
        }

        function stCanvasToBytes(cv) {
            return new Promise((res, rej) => {
                if (typeof cv.toBlob !== 'function') { rej(new Error('这个浏览器不支持画布导出')); return; }
                cv.toBlob(async blob => {
                    if (!blob) { rej(new Error('画布导出失败')); return; }
                    try { res(new Uint8Array(await blob.arrayBuffer())); }
                    catch (e) { rej(e); }
                }, 'image/png');
            });
        }

        // 非 PNG 的头像（jpg / webp）统一画进画布转成 PNG，按 400×600 铺满裁切
        async function stRasterToPng(dataUrl) {
            const img = await stLoadImage(dataUrl);
            const W = ST_PLACEHOLDER_W, H = ST_PLACEHOLDER_H;
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const ctx = cv.getContext('2d');
            const scale = Math.max(W / (img.width || 1), H / (img.height || 1));
            const dw = (img.width || 1) * scale, dh = (img.height || 1) * scale;
            ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
            return await stCanvasToBytes(cv);
        }

        // 没选头像时画一张占位图，免得导出的 PNG 缺了正脸
        async function stPlaceholderPng() {
            const W = ST_PLACEHOLDER_W, H = ST_PLACEHOLDER_H;
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const ctx = cv.getContext('2d');
            const g = ctx.createLinearGradient(0, 0, W, H);
            g.addColorStop(0, '#79d2b3');
            g.addColorStop(0.5, '#79c4d2');
            g.addColorStop(1, '#7998d2');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            ctx.beginPath();
            ctx.arc(W / 2, H * 0.37, 92, 0, Math.PI * 2);
            ctx.fill();
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 34px "ZCOOL Gaodeng", sans-serif';
            ctx.fillText(String(stEditor.card.name || '未命名角色').slice(0, 10), W / 2, H * 0.62);
            ctx.font = '16px "Share Tech Mono", monospace';
            ctx.fillText('NO AVATAR', W / 2, H * 0.70);
            return await stCanvasToBytes(cv);
        }

        // 导出用的头像字节：PNG 就原样用（不重编码，免得掉质量），别的格式转一道
        async function stAvatarPngBytes() {
            const a = stEditor.avatar;
            if (a) {
                if (stMimeOfDataUrl(a) === 'image/png') {
                    const bytes = stDataUrlToBytes(a);
                    if (isPngBuffer(bytes)) return bytes;
                }
                return await stRasterToPng(a);
            }
            return await stPlaceholderPng();
        }

        function stDownload(filename, blob) {
            let url = '';
            try { url = URL.createObjectURL(blob); }
            catch (e) { throw new Error('这个环境不支持生成下载链接'); }
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 3000);
        }

        function stSafeFileName(s) {
            // 文件名里不能有的字符。故意用 new RegExp 拼出来 —— 写成正则字面量的话
            // 里面的那个双引号会把静态检查的大括号扫描器带进字符串状态
            const bad = new RegExp('[\\\\/:*?' + String.fromCharCode(34) + '<>|]+', 'g');
            const base = String(s || '').trim().replace(bad, '_')
                .replace(/\s+/g, ' ').slice(0, 60).trim();
            return base || 'character';
        }

