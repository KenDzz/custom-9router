# Cập nhật custom lên upstream v0.5.111

Ngày kiểm tra: 28/10/2026.

- Bản custom gốc: 0fa6e839, dựa trên upstream v0.5.35 (bc252ea8).
- Upstream đã tích hợp: tag v0.5.111, commit 3a978a631ad65529c06e48ce495092d5bba29f46, phát hành 26/10/2026.
- Nhánh tích hợp: codex/update-custom-v0.5.111; nhánh custom local được fast-forward đến bản đã kiểm tra. Bản custom gốc 0fa6e839 được giữ tại codex/backup-custom-v0.5.35 và trong lịch sử merge. Chưa push hoặc triển khai.

## Phần đã giữ và hòa giải

Giữ workspace/RBAC, user/profile/đổi mật khẩu, lời mời, hạn mức token, quà tặng/reset usage, model access và Token Saver theo workspace/thành viên. Hòa giải 32 file xung đột thay vì chọn toàn bộ một phía.

Tích hợp các thay đổi upstream về provider/model, routing, SAML, quyền theo API key, custom STT transport, quota ping theo lịch và background refresh. Các route/callback/job mới được đưa qua ranh giới workspace tương ứng. Backup API key giữ cả chủ sở hữu thành viên và giới hạn truy cập upstream. SAML tạo user/session có workspace; email bên ngoài không tự chiếm tài khoản local.

Giữ migration 001–005; nâng backup schema version lên 6 để tự sao lưu trước khi đồng bộ cột accessRestricted/accessAllow. Test nâng DB custom v5 xác nhận khóa, user, workspace và hạn mức còn nguyên. Không chạy migration trên database đang sử dụng của người dùng.

Đồng bộ package-lock.json vì npm ci với lockfile upstream ban đầu báo thiếu dependency. Sửa import Link bị thiếu ở trang combo và giữ directive use server ở đầu các route CLI được bọc workspace.

## Kết quả kiểm tra

- Custom/auth/migration/integration: **180/180 test qua** trong 17 file.
- DB/usage/request details: **59/59 test qua** trong lượt kiểm tra chuyên biệt.
- Zed native OAuth/live models: **18/18 test qua**.
- Toàn bộ unit suite cuối: **3808 qua, 31 lỗi, 24 bỏ qua, 1 todo**. Đối chiếu tên từng test lỗi với upstream nguyên gốc: **không có tên test lỗi mới**. Cả hai bản được chạy trên cùng máy và cùng dependency.
- Production Turbopack build: **thành công**, gồm TypeScript, prerender và standalone. Đã chạy copy-standalone-assets.mjs.
- Standalone HTTP smoke: **14/14 qua**, gồm health, chặn request chưa đăng nhập, đăng nhập admin, user/workspace identity, provider/custom model/presets, trang combo, tạo API key, catalog model, lookup 404 và validation System One. Database test riêng; server test đã dừng.
- git diff --check trên phần sửa tích hợp: qua. Kiểm tra toàn bộ staged diff còn cảnh báo whitespace từ các file upstream (gồm Markdown có khoảng trắng xuống dòng); giữ nguyên nội dung đó. ESLint kiểm tra 941 file, không có lỗi parser; còn lint debt chủ yếu React Hooks. 117 lỗi lint nằm trong các file giữ nguyên byte nội dung từ upstream (sau chuẩn hóa CRLF). Chưa có lint pass toàn dự án.

## Giới hạn xác minh

Script npm run build upstream vẫn dùng webpack. Trên checkout Windows này, bước NFT filesystem tracing kéo dài và đã được dừng; không coi lượt webpack đó là thành công. Production được xác minh bằng Turbopack với cùng mã nguồn và dependency, không đổi script build upstream.

Các test còn lỗi có nguyên nhân từ upstream/fixture/môi trường: mạng và provider live, thiếu ffmpeg/lowdb/cloud source, giả định đường dẫn Linux, hoặc assertion cũ của translator/combo/security. Không sửa hành vi upstream chỉ để ép các assertion đó qua. Chưa xác minh toàn bộ provider bằng tài khoản thật hoặc SAML IdP thật; không thể cam kết tuyệt đối mọi tích hợp bên ngoài không bị ảnh hưởng.

Các file test còn lỗi:

- claude-header-forwarding.test.js
- codebuddy-block-backoff.test.js
- codex-stt-persisted-refresh.test.js
- codex-stt-transport.test.js
- combo-autoswitch.test.js
- combo-credit-fallback.test.js
- db-benchmark.test.js
- embeddings.cloud.test.js
- headroom-detect.test.js
- headroom-responses-format.test.js
- mimo-free.live.test.js
- oauth-cursor-auto-import.test.js
- openai-to-claude.test.js
- security-audit.test.js
- translator-request-normalization.test.js

## Tái kiểm tra

Dùng Node theo .nvmrc cho triển khai; lượt unit rộng chạy bằng Node 24 bundled, lượt custom và production smoke chạy bằng Node 20.19.4 có sẵn trên máy.

Từ thư mục tests, chạy vitest run --config vitest.config.js unit --maxWorkers=3 --testTimeout=15000 --hookTimeout=30000. Với production kiểm tra ở workspace root, đặt DATA_DIR vào thư mục test riêng và NEXT_DIST_DIR=.next-upgrade-turbo, rồi chạy node node_modules/next/dist/bin/next build --turbopack và node scripts/copy-standalone-assets.mjs. Giữ NEXT_DIST_DIR khi copy assets.

Log/JSON chi tiết giữ cục bộ trong .tmp-upgrade/ (gitignored): final-results.json, upstream-results.json, custom-final.log, zed-tests.log, smoke-results.json, build-production.log và eslint.json.
