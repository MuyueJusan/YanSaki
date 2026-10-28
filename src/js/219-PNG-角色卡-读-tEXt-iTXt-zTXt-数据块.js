        // ===== PNG 角色卡：读 tEXt / iTXt / zTXt 数据块 =====

        function bytesToLatin1(u8) {
            let s = '';
            for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
            return s;
        }

        function isPngBuffer(buf) {
            const u8 = new Uint8Array(buf);
            const sig = [137, 80, 78, 71, 13, 10, 26, 10];
            return u8.length >= 8 && sig.every((b, i) => u8[i] === b);
        }

        function readPngTextChunks(buf) {
            // 调用方有的给 ArrayBuffer（File.arrayBuffer()），有的给 Uint8Array，
            // 都得认；DataView 只吃 ArrayBuffer，所以要显式带 offset / length
            const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
            const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
            const out = {};
            let off = 8;
            while (off + 8 <= u8.length) {
                const len = dv.getUint32(off);
                const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
                const dataStart = off + 8;
                const dataEnd = dataStart + len;
                if (dataEnd > u8.length) break;
                if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
                    let kEnd = dataStart;
                    while (kEnd < dataEnd && u8[kEnd] !== 0) kEnd++;
                    const keyword = bytesToLatin1(u8.subarray(dataStart, kEnd));
                    if (keyword) {
                        if (type === 'tEXt') {
                            out[keyword] = { kind: 'text', bytes: u8.subarray(kEnd + 1, dataEnd) };
                        } else if (type === 'zTXt') {
                            // keyword\0 compressionMethod(1) 之后是 zlib 流
                            out[keyword] = { kind: 'zlib', bytes: u8.subarray(kEnd + 2, dataEnd) };
                        } else {
                            // iTXt: keyword\0 compFlag(1) compMethod(1) langTag\0 transKeyword\0 text
                            let p = kEnd + 1;
                            const compFlag = u8[p];
                            p += 2;
                            let lEnd = p; while (lEnd < dataEnd && u8[lEnd] !== 0) lEnd++;
                            p = lEnd + 1;
                            let tEnd = p; while (tEnd < dataEnd && u8[tEnd] !== 0) tEnd++;
                            p = tEnd + 1;
                            out[keyword] = compFlag
                                ? { kind: 'zlib', bytes: u8.subarray(p, dataEnd) }
                                : { kind: 'text', bytes: u8.subarray(p, dataEnd) };
                        }
                    }
                }
                if (type === 'IEND') break;
                off = dataEnd + 4;   // 跳过 CRC
            }
            return out;
        }

        async function decodePngCardChunk(rec) {
            let bytes = rec.bytes;
            if (rec.kind === 'zlib') {
                if (typeof DecompressionStream === 'undefined') {
                    throw new Error('这个浏览器不支持解压 zTXt 数据块');
                }
                const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
                bytes = new Uint8Array(await new Response(stream).arrayBuffer());
            }
            let text = new TextDecoder('utf-8').decode(bytes).trim();
            if (!text) throw new Error('数据块是空的');
            // 卡数据是 base64(UTF-8 JSON)；偶尔有人直接塞裸 JSON
            if (text.charAt(0) !== '{') {
                let bin;
                try { bin = atob(text.replace(/\s+/g, '')); }
                catch (e) { throw new Error('数据块不是合法的 base64'); }
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                text = new TextDecoder('utf-8').decode(arr);
            }
            return JSON.parse(text);
        }

