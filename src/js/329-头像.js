        // ===== 头像 =====

        function stReadDataUrl(file) {
            return new Promise((res, rej) => {
                const fr = new FileReader();
                fr.onload = () => res(String(fr.result || ''));
                fr.onerror = () => rej(new Error('文件读取失败'));
                fr.readAsDataURL(file);
            });
        }

        function stPickAvatar() {
            const el = document.getElementById('st-avatar-file');
            if (el) el.click();
        }

        async function stOnAvatarPicked(ev) {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!file) return;
            if (!/^image\//.test(file.type || '')) {
                stExportMsg('❌ 头像得是图片文件（png / jpg / webp 都行）', 'bad');
                return;
            }
            try {
                stEditor.avatar = await stReadDataUrl(file);
                stEditor.avatarName = file.name;
                stSaveDraft();
                stRerender();
                stExportMsg('✅ 头像已设为 ' + file.name +
                    (stEditor.avatar.length > ST_AVATAR_MAX
                        ? '（超过 ' + Math.round(ST_AVATAR_MAX / 1024) +
                          ' KB，刷新后需要重选）' : ''), 'ok');
            } catch (e) {
                stExportMsg('❌ 头像读取失败：' + (e && e.message ? e.message : e), 'bad');
            }
        }

        function stClearAvatar() {
            stEditor.avatar = null;
            stEditor.avatarName = '';
            stSaveDraft();
            stRerender();
        }

