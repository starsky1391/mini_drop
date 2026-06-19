SHELL := /bin/sh

COMPOSE ?= docker compose
DEMO_COMPOSE := $(COMPOSE) -f docker-compose.yml -f docker-compose.ebpf-demo.yml
DEMO_TARGET ?= mini-drop-demo-target

.PHONY: demo demo-up demo-wait demo-pid demo-load demo-io demo-sched demo-smoke demo-down

demo: demo-up demo-wait demo-pid

demo-up:
	$(DEMO_COMPOSE) up --build -d mini-drop-server mini-drop-agent $(DEMO_TARGET)

demo-wait:
	@i=0; until curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; do \
		i=$$((i + 1)); \
		if [ "$$i" -ge 60 ]; then echo "Mini-Drop did not become healthy"; exit 1; fi; \
		sleep 2; \
	done
	@i=0; until curl -fsS http://127.0.0.1:18080/health >/dev/null 2>&1; do \
		i=$$((i + 1)); \
		if [ "$$i" -ge 60 ]; then echo "demo target did not become healthy"; exit 1; fi; \
		sleep 2; \
	done

demo-pid:
	@container="$$( $(DEMO_COMPOSE) ps -q $(DEMO_TARGET) )"; \
	if [ -z "$$container" ]; then echo "demo target container is not running"; exit 1; fi; \
	pid="$$(docker inspect -f '{{.State.Pid}}' "$$container")"; \
	echo ""; \
	echo "Mini-Drop UI: http://127.0.0.1:8787/"; \
	echo "Demo target: http://127.0.0.1:18080/health"; \
	echo "Use this PID in Mini-Drop: $$pid"; \
	echo "Recommended task: targetType=pid/process, language=Go, collector=eBPF, scenario=cpu_hot"; \
	echo ""; \
	echo "Generate service load: make demo-load"; \
	echo "Generate raw IO jitter: make demo-io"; \
	echo "Generate scheduler jitter: make demo-sched"; \
	echo "";

demo-load:
	$(DEMO_COMPOSE) --profile loadgen up demo-loadgen

demo-io:
	$(DEMO_COMPOSE) --profile jitter run --rm io-jitter

demo-sched:
	$(DEMO_COMPOSE) --profile jitter run --rm sched-jitter

demo-smoke:
	$(DEMO_COMPOSE) exec mini-drop-server npm run smoke:api
	$(DEMO_COMPOSE) exec mini-drop-server npm run smoke:ebpf-linux

demo-down:
	$(DEMO_COMPOSE) down
