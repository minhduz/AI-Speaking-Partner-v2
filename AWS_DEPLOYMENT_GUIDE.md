# AWS Deployment Guide - AI Speaking Partner

Tài liệu này mô tả cách deploy dự án `AI-Speaking-Partner-v2` lên AWS theo kiến trúc microservice hiện tại của repo.

Repo hiện có:

- Frontend: Next.js standalone container trong `FE`
- Backend NestJS services trong `BE/apps`
- Backend Python/FastAPI services trong `BE/services`
- Database: PostgreSQL + `pgvector`
- Cache/state: Redis
- Local orchestration: `docker-compose.yml`

## 1. Kiến trúc đề xuất

Khuyến nghị dùng:

- Route 53: quản lý domain/DNS
- AWS Certificate Manager: SSL/TLS certificate
- Application Load Balancer: public HTTPS entrypoint
- ECS Fargate: chạy các Docker container
- ECR: lưu Docker images
- RDS PostgreSQL: database production, có `pgvector`
- ElastiCache Redis: Redis production
- Secrets Manager hoặc SSM Parameter Store: lưu secret/env nhạy cảm
- CloudWatch Logs: log từng service
- VPC: public subnet cho ALB, private subnet cho ECS/RDS/Redis

```text
User
  |
  | HTTPS
  v
Route 53 + ACM
  |
  v
Application Load Balancer
  |
  |---------------- public routes ----------------|
  |                                               |
  v                                               v
FE Next.js ECS Service                       Orchestrator ECS Service
port 3002                                    port 3000
                                                  |
                                                  | private service discovery
                                                  |
        --------------------------------------------------------------------
        |              |              |              |                     |
        v              v              v              v                     v
Billing Service  Dictionary      LLM Gateway     Memory Service       Speech Service
port 3001        port 3005       port 8002       port 8001            port 8010
        |              |                              |                     |
        --------------------------                    |                     |
                                  v                   v                     |
                         RDS PostgreSQL          ElastiCache Redis          |
                         + pgvector                                          
```

## 2. AWS services cần dùng

| AWS service | Dùng để làm gì |
|---|---|
| Route 53 | DNS cho domain đã mua |
| ACM | Cấp HTTPS certificate miễn phí |
| ALB | Route traffic vào FE, orchestrator, speech WebSocket |
| ECS Fargate | Chạy các container microservice |
| ECR | Docker image registry |
| RDS PostgreSQL | Database chính thay cho Postgres container |
| ElastiCache Redis | Redis production thay cho Redis container |
| Secrets Manager / SSM | Lưu API keys, DB passwords, JWT secret |
| CloudWatch Logs | Xem logs, debug service |
| VPC/Subnets/Security Groups | Network isolation |
| NAT Gateway | Cho private ECS tasks gọi OpenAI/Gemini/Soniox/SePay |

## 3. Service map của repo

| Service | Source | Port | Public? | Ghi chú |
|---|---|---:|---|---|
| Frontend | `FE` | `3002` | Có | Next.js standalone |
| Orchestrator | `BE/apps/orchestrator` | `3000` | Có | API gateway chính |
| Billing | `BE/apps/billing-service` | `3001` | Không | Đi qua orchestrator |
| Dictionary | `BE/apps/dictionary-service` | `3005` | Không | Nhớ set `PORT=3005` |
| LLM Gateway | `BE/apps/llm-gateway` | `8002` | Không | Gemini/OpenAI gateway |
| Memory | `BE/services/memory-service` | `8001` | Không | Cần Postgres + Redis |
| Speech | `BE/services/speech-service` | `8010` | Có hoặc proxy | FE hiện gọi trực tiếp WebSocket STT |
| Turn Agent | `BE/services/turn-agent` | `8003` | Không | Stream turn pipeline |
| PostgreSQL | RDS | `5432` | Không | Cần `vector` extension |
| Redis | ElastiCache | `6379` | Không | Memory short-term/cache |

## 4. Domain layout khuyến nghị

Giả sử domain là `yourdomain.com`:

```text
app.yourdomain.com      -> FE Next.js
api.yourdomain.com      -> Orchestrator
speech.yourdomain.com   -> Speech service WebSocket/STT
```

Lý do cần `speech.yourdomain.com`: frontend hiện đang dùng biến:

```env
NEXT_PUBLIC_SPEECH_SERVICE_URL
```

và gọi WebSocket tới:

```text
/stt/ws
```

Nếu muốn gọn hơn sau này, có thể sửa orchestrator để proxy toàn bộ speech endpoint. Khi đó FE chỉ cần gọi `api.yourdomain.com`.

## 5. Network layout

Tạo một VPC gồm:

- 2 public subnets ở 2 Availability Zones
- 2 private subnets ở 2 Availability Zones
- Internet Gateway cho public subnets
- NAT Gateway để ECS private tasks gọi external APIs
- Security Groups tách riêng cho ALB, ECS, RDS, Redis

Security group gợi ý:

| Security group | Inbound |
|---|---|
| `sg-alb` | `80`, `443` từ internet |
| `sg-ecs-public` | Port app từ `sg-alb` |
| `sg-ecs-internal` | Internal service ports từ ECS services |
| `sg-rds` | `5432` từ ECS services |
| `sg-redis` | `6379` từ ECS services |

Không mở RDS/Redis ra internet.

## 6. Database production

Tạo RDS PostgreSQL:

- Engine: PostgreSQL 15.2 hoặc mới hơn
- DB name: `speaking_app`
- Public access: `No`
- Multi-AZ: nên bật khi production thật
- Backup retention: tối thiểu 7 ngày

Sau khi tạo DB, chạy `BE/init.sql` một lần bằng user admin của RDS.

Quan trọng: file init cần extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

RDS PostgreSQL 15.2+ có hỗ trợ `pgvector`, phù hợp với bảng:

```sql
memory.memory_facts.embedding vector(1536)
```

Sau khi chạy init, app services sẽ dùng các DB users:

```text
orchestrator_user
billing_user
memory_user
dictionary_user
```

Production nên đổi password trong `init.sql` trước khi chạy lần đầu, hoặc tạo user/password bằng script riêng rồi lưu vào Secrets Manager.

## 7. Redis production

Tạo ElastiCache Redis:

- Engine: Redis 7 hoặc mới hơn
- Private subnet
- Inbound `6379` chỉ từ ECS security group
- Nếu production thật: bật automatic backup/snapshot nếu cần

Env cho memory-service:

```env
REDIS_URL=redis://<elasticache-primary-endpoint>:6379/0
```

## 8. Container registry ECR

Tạo ECR repositories:

```text
ai-speaking-fe
ai-speaking-orchestrator
ai-speaking-billing-service
ai-speaking-dictionary-service
ai-speaking-llm-gateway
ai-speaking-memory-service
ai-speaking-speech-service
ai-speaking-turn-agent
```

Build và push từng image. Ví dụ:

```bash
aws ecr get-login-password --region ap-southeast-1 \
  | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com

docker build -t ai-speaking-orchestrator ./BE/apps/orchestrator
docker tag ai-speaking-orchestrator:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/ai-speaking-orchestrator:latest
docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/ai-speaking-orchestrator:latest
```

Làm tương tự cho các service khác.

## 9. ECS Fargate setup

Tạo một ECS Cluster:

```text
ai-speaking-prod
```

Tạo một Task Definition + ECS Service cho mỗi microservice.

Gợi ý CPU/RAM ban đầu:

| Service | CPU | RAM |
|---|---:|---:|
| FE | `0.25 vCPU` | `512 MB` |
| Orchestrator | `0.5 vCPU` | `1 GB` |
| Billing | `0.25 vCPU` | `512 MB` |
| Dictionary | `0.25 vCPU` | `512 MB` |
| LLM Gateway | `0.25 vCPU` | `512 MB` |
| Memory | `0.5 vCPU` | `1 GB` |
| Speech | `0.5-1 vCPU` | `1-2 GB` |
| Turn Agent | `0.5-1 vCPU` | `1-2 GB` |

Speech và turn-agent có streaming/audio/LLM flow nên nên cấp dư hơn các service CRUD.

## 10. Internal service discovery

Dùng ECS Service Connect hoặc AWS Cloud Map để service gọi nhau bằng private DNS name.

Các URL nội bộ nên giữ dạng:

```env
BILLING_SERVICE_URL=http://billing-service:3001
MEMORY_SERVICE_URL=http://memory-service:8001
LLM_GATEWAY_URL=http://llm-gateway:8002
SPEECH_SERVICE_URL=http://speech-service:8010
DICTIONARY_SERVICE_URL=http://dictionary-service:3005
```

Nếu không dùng Service Connect, có thể dùng internal ALB, nhưng Service Connect/Cloud Map gọn hơn cho microservice nhỏ.

## 11. Application Load Balancer routing

Tạo ALB public:

- Listener `80`: redirect sang `443`
- Listener `443`: gắn ACM certificate

Target groups:

| Host/path | Target group | Container port |
|---|---|---:|
| `app.yourdomain.com` | FE | `3002` |
| `api.yourdomain.com` | Orchestrator | `3000` |
| `speech.yourdomain.com` | Speech | `8010` |

ALB idle timeout:

- Set khoảng `120-300s`
- Lý do: app có SSE và WebSocket, ví dụ billing payment stream, turn stream, speech STT WebSocket

Health checks:

| Service | Health check |
|---|---|
| FE | `/` |
| Orchestrator | cần thêm `/health` nếu chưa có |
| Speech | `/health` |
| Memory | `/health` |
| LLM Gateway | `/completion/health` hoặc endpoint thực tế của controller |

Nên thêm `/health` cho các NestJS service chưa có endpoint health rõ ràng.

## 12. Route 53 + SSL

Trong Route 53:

```text
app.yourdomain.com      A Alias -> ALB
api.yourdomain.com      A Alias -> ALB
speech.yourdomain.com   A Alias -> ALB
```

Trong ACM:

Tạo certificate cho:

```text
app.yourdomain.com
api.yourdomain.com
speech.yourdomain.com
```

Hoặc wildcard:

```text
*.yourdomain.com
```

Validate bằng DNS record trong Route 53.

## 13. Production env

### FE

```env
NODE_ENV=production
PORT=3002
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
BACKEND_URL=https://api.yourdomain.com
NEXT_PUBLIC_SPEECH_SERVICE_URL=https://speech.yourdomain.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<google-client-id>
```

Lưu ý: `NEXT_PUBLIC_*` được bake vào build frontend. Khi đổi các biến này, cần rebuild FE image.

Hiện `FE/Dockerfile` mới khai báo `NEXT_PUBLIC_API_URL`. Nên thêm build args cho:

```env
NEXT_PUBLIC_SPEECH_SERVICE_URL
NEXT_PUBLIC_GOOGLE_CLIENT_ID
```

### Orchestrator

```env
NODE_ENV=production
PORT=3000

DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_USER=orchestrator_user
DB_PASS=<secret>
DB_NAME=speaking_app
DB_SCHEMA=speaking_app

JWT_SECRET=<long-random-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

BILLING_SERVICE_URL=http://billing-service:3001
MEMORY_SERVICE_URL=http://memory-service:8001
LLM_GATEWAY_URL=http://llm-gateway:8002
SPEECH_SERVICE_URL=http://speech-service:8010
DICTIONARY_SERVICE_URL=http://dictionary-service:3005

GOOGLE_CLIENT_ID=<google-client-id>
```

### Billing service

```env
NODE_ENV=production
PORT=3001

DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_USER=billing_user
DB_PASS=<secret>
DB_NAME=speaking_app
DB_SCHEMA=billing

SEPAY_WEBHOOK_TOKEN=<secret-token>
SEPAY_BANK_NAME=<bank-name>
SEPAY_ACCOUNT_NUMBER=<account-number>
SEPAY_ACCOUNT_NAME=<account-name>
PAYMENT_EXPIRY_MINUTES=15
```

Kiểm tra code đang dùng tên biến nào chính xác. Trong code hiện có `SEPAY_WEBHOOK_TOKEN`, còn README cũ có thể ghi `SEPAY_WEBHOOK_SECRET`.

Webhook URL đưa cho SePay:

```text
https://api.yourdomain.com/billing/sepay/webhook
```

### LLM Gateway

```env
NODE_ENV=production
PORT=8002

GEMINI_API_KEY=<secret>
GEMINI_MODEL=<model>

OPENAI_API_KEY=<secret>
OPENAI_MODEL=<model>

MAX_TOKENS=1024
RETRY_ATTEMPTS=3
```

### Memory service

```env
PORT=8001

DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_USER=memory_user
DB_PASS=<secret>
DB_NAME=speaking_app

REDIS_URL=redis://<elasticache-primary-endpoint>:6379/0

OPENAI_API_KEY=<secret>
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
SHORT_TERM_TTL_SECONDS=604800
LONG_TERM_TTL_DAYS=365
```

### Speech service

```env
PORT=8010

SONIOX_API_KEY=<secret>
STT_LANGUAGE=en
SONIOX_STT_MODEL=stt-rt-v4
SONIOX_TTS_MODEL=tts-rt-v1
SONIOX_TTS_VOICE=Adrian
SONIOX_TTS_SAMPLE_RATE=24000
SONIOX_TEMP_KEY_EXPIRES_SECONDS=60
```

Lưu ý: source hiện tại dùng Soniox, không còn đơn thuần OpenAI Whisper/TTS như README cũ.

### Turn Agent

```env
PORT=8003

DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_USER=orchestrator_user
DB_PASS=<secret>
DB_NAME=speaking_app

SPEECH_SERVICE_URL=http://speech-service:8010
MEMORY_SERVICE_URL=http://memory-service:8001
LLM_GATEWAY_URL=http://llm-gateway:8002
BILLING_SERVICE_URL=http://billing-service:3001
```

### Dictionary service

```env
NODE_ENV=production
PORT=3005

DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_USER=dictionary_user
DB_PASS=<secret>
DB_NAME=speaking_app

WORDNIK_API_KEY=<optional-secret>
```

## 14. Secrets

Không hardcode secret vào task definition plain text nếu có thể tránh.

Nên đưa các biến này vào Secrets Manager hoặc SSM Parameter Store:

```text
DB_PASS
JWT_SECRET
GOOGLE_CLIENT_ID nếu không muốn public ở BE
OPENAI_API_KEY
GEMINI_API_KEY
SONIOX_API_KEY
SEPAY_WEBHOOK_TOKEN
SEPAY_ACCOUNT_NUMBER
```

Riêng `NEXT_PUBLIC_*` của FE là public by design. Không đặt secret vào `NEXT_PUBLIC_*`.

## 15. CI/CD gợi ý với GitHub Actions

Flow:

```text
push main
  -> npm test/build nếu có
  -> docker build từng service
  -> push image lên ECR
  -> update ECS service
```

Pseudo commands:

```bash
docker build -t <ecr>/ai-speaking-fe:$GITHUB_SHA ./FE
docker push <ecr>/ai-speaking-fe:$GITHUB_SHA
aws ecs update-service \
  --cluster ai-speaking-prod \
  --service fe \
  --force-new-deployment
```

Lặp lại cho từng service.

Nên dùng image tag theo commit SHA thay vì chỉ dùng `latest`.

## 16. Checklist trước khi production

- RDS đã chạy `BE/init.sql`
- `pgvector` extension tạo thành công
- Redis private endpoint hoạt động
- ECS tasks nằm private subnet
- ALB listener `80 -> 443`
- ACM certificate đã issued
- Route 53 records đã trỏ đúng ALB
- FE build đúng `NEXT_PUBLIC_API_URL`
- FE build đúng `NEXT_PUBLIC_SPEECH_SERVICE_URL`
- Orchestrator gọi được billing/memory/llm/speech/dictionary nội bộ
- Speech WebSocket `/stt/ws` chạy qua HTTPS/WSS
- SePay webhook trỏ tới `https://api.yourdomain.com/billing/sepay/webhook`
- CloudWatch log group có logs cho tất cả service
- Không expose RDS/Redis public
- ALB idle timeout đủ dài cho SSE/WebSocket
- Đã bật backup RDS
- Đã đổi toàn bộ password mặc định trong `init.sql`

## 17. Các điểm cần chỉnh trong source trước khi deploy

### 17.1 Thêm build args cho FE Dockerfile

Hiện `FE/Dockerfile` chỉ nhận:

```dockerfile
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
```

Nên thêm:

```dockerfile
ARG NEXT_PUBLIC_SPEECH_SERVICE_URL=http://localhost:8010
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=
ENV NEXT_PUBLIC_SPEECH_SERVICE_URL=$NEXT_PUBLIC_SPEECH_SERVICE_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
```

### 17.2 Thêm health endpoint cho NestJS services

Nên có:

```text
GET /health
```

cho:

- orchestrator
- billing-service
- dictionary-service

Để ALB/ECS health check dễ và ổn định.

### 17.3 Đồng bộ README env với code thật

README cũ có vài biến không còn khớp:

- Speech service source hiện dùng `SONIOX_API_KEY`
- Billing webhook source dùng `SEPAY_WEBHOOK_TOKEN`
- Dictionary service cần `PORT=3005`

Nên cập nhật README sau khi chốt production env.

## 18. Thứ tự triển khai thực tế

1. Chọn region, ví dụ `ap-southeast-1` nếu team/user ở Việt Nam.
2. Tạo Route 53 hosted zone hoặc trỏ nameserver domain về Route 53.
3. Tạo ACM certificate cho domain/subdomain.
4. Tạo VPC/subnets/security groups.
5. Tạo RDS PostgreSQL.
6. Chạy `BE/init.sql`.
7. Tạo ElastiCache Redis.
8. Tạo ECR repositories.
9. Build/push Docker images.
10. Tạo ECS cluster.
11. Tạo ECS task definitions.
12. Tạo ECS services internal trước: billing, dictionary, llm-gateway, memory, speech, turn-agent.
13. Tạo orchestrator service.
14. Tạo FE service.
15. Tạo ALB listeners/rules/target groups.
16. Tạo Route 53 alias records.
17. Test login/register/session/speech/billing webhook.
18. Bật monitoring/alerts/backups.

## 19. Test sau khi deploy

Test public endpoints:

```bash
curl https://api.yourdomain.com/health
curl https://speech.yourdomain.com/health
curl https://app.yourdomain.com
```

Test WebSocket từ browser:

```text
wss://speech.yourdomain.com/stt/ws
```

Test DB:

```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
SELECT COUNT(*) FROM speaking_app.users;
SELECT COUNT(*) FROM billing.plans;
```

Test billing:

```text
https://api.yourdomain.com/billing/plans
https://api.yourdomain.com/billing/sepay/webhook
```

## 20. Phương án rẻ hơn cho giai đoạn đầu

Nếu muốn tiết kiệm chi phí giai đoạn MVP:

- 1 EC2 instance chạy `docker compose`
- RDS PostgreSQL riêng
- ElastiCache có thể tạm dùng Redis container nếu ít user
- Nginx/Caddy trên EC2 làm reverse proxy + SSL

Nhưng vì backend đã là microservice và có nhiều container, đường dài nên đi ECS Fargate. EC2 compose rẻ hơn nhưng vận hành thủ công hơn, khó scale và khó tách service.

## 21. Tóm tắt quyết định nên chọn

Cho production nghiêm túc:

```text
ECS Fargate + ECR + ALB + Route 53 + ACM + RDS PostgreSQL + ElastiCache Redis + Secrets Manager + CloudWatch
```

Cho MVP/ít user/muốn deploy nhanh:

```text
EC2 Docker Compose + RDS PostgreSQL + Route 53 + Caddy/Nginx SSL
```

Với repo hiện tại, khuyến nghị chính vẫn là ECS Fargate vì app đã chia microservice rõ ràng, có nhiều runtime khác nhau, có WebSocket/SSE, và cần private networking giữa services.

## 22. Tài liệu AWS liên quan

- RDS PostgreSQL hỗ trợ pgvector: https://aws.amazon.com/about-aws/whats-new/2023/05/amazon-rds-postgresql-pgvector-ml-model-integration/
- Route 53 alias tới ALB: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-elb-load-balancer.html
- ECS Service Connect: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-connect.html
- Application Load Balancer WebSocket support: https://aws.amazon.com/about-aws/whats-new/2016/08/announcing-application-load-balancer-for-elastic-load-balancing/
