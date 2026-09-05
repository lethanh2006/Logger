# CI trên GitHub

Workflow [ci.yml](workflows/ci.yml) chạy unit test của
`packages/observability` khi push code, mở/cập nhật Pull Request hoặc chạy thủ
công từ tab **Actions → CI**.

CI dùng Node.js 22 và `npm ci`. Package là JavaScript chạy trực tiếp nên chưa
có bước build hay ESLint. Workflow này chưa kiểm tra cấu hình Docker,
Prometheus/Alertmanager hoặc chạy smoke test cần hạ tầng. Không cần file
`.env`, webhook Discord, database hay VPS.

Chạy tương tự ở local, từ thư mục repo Logger:

```bash
npm ci --prefix packages/observability --no-audit --no-fund
CI=true NODE_ENV=test OBSERVABILITY_LOAD_DOTENV=false OTEL_SDK_DISABLED=true LOG_FORMAT=json npm test --prefix packages/observability
```

Các repo service checkout package từ repo Logger tại một commit được ghim trong
workflow của từng repo. Sau khi đổi shared package, push Logger trước, rồi cập
nhật variable `LOGGER_REF` của các service sang commit mới và chạy CI của chúng.
CI Logger chỉ chạy test package; nó không tự chạy lại test của các repo service.

Tham khảo: [GitHub Actions cho Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).
