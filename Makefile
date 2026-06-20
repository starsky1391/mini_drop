COMPOSE ?= docker compose
DEMO_COMPOSE := $(COMPOSE) -f docker-compose.yml -f docker-compose.ebpf-demo.yml
DEMO_TARGET ?= mini-drop-demo-target
MINI_DROP_HOST_PORT ?= 8787

.PHONY: demo demo-up demo-wait demo-pid demo-load demo-load-stop demo-io demo-sched demo-smoke demo-down

demo: demo-up demo-wait demo-pid

demo-up:
	$(DEMO_COMPOSE) up --build -d mini-drop-server mini-drop-agent $(DEMO_TARGET)

demo-wait:
	node scripts/demo-control.mjs wait

demo-pid:
	node scripts/demo-control.mjs pid

demo-load:
	node scripts/demo-control.mjs load

demo-load-stop:
	node scripts/demo-control.mjs load-stop

demo-io:
	$(DEMO_COMPOSE) --profile jitter run --rm io-jitter

demo-sched:
	$(DEMO_COMPOSE) --profile jitter run --rm sched-jitter

demo-smoke:
	$(DEMO_COMPOSE) exec mini-drop-server npm run smoke:api
	$(DEMO_COMPOSE) exec mini-drop-server npm run smoke:ebpf-linux

demo-down:
	$(DEMO_COMPOSE) down
