package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync/atomic"
	"time"
)

var requestID uint64

func main() {
	dataDir := getenv("DEMO_DATA_DIR", "/data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.HandleFunc("/cpu", func(w http.ResponseWriter, r *http.Request) {
		ms := intParam(r, "ms", 700)
		digest, rounds := burnCPU(time.Duration(ms) * time.Millisecond)
		fmt.Fprintf(w, "cpu_ms=%d rounds=%d digest=%s\n", ms, rounds, digest)
	})
	mux.HandleFunc("/io", func(w http.ResponseWriter, r *http.Request) {
		mb := intParam(r, "mb", 16)
		written, checksum, err := doIO(dataDir, mb)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(w, "io_mb=%d bytes=%d checksum=%s\n", mb, written, checksum)
	})
	mux.HandleFunc("/mixed", func(w http.ResponseWriter, r *http.Request) {
		ms := intParam(r, "ms", 500)
		mb := intParam(r, "mb", 8)
		digest, rounds := burnCPU(time.Duration(ms) * time.Millisecond)
		written, checksum, err := doIO(dataDir, mb)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(w, "mixed cpu_ms=%d rounds=%d digest=%s io_mb=%d bytes=%d checksum=%s\n", ms, rounds, digest, mb, written, checksum)
	})

	addr := ":8080"
	log.Printf("mini-drop demo target pid=%d addr=%s data=%s gomaxprocs=%d", os.Getpid(), addr, dataDir, runtime.GOMAXPROCS(0))
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func burnCPU(duration time.Duration) (string, int) {
	deadline := time.Now().Add(duration)
	seed := []byte("mini-drop-demo-target")
	var sum [32]byte
	rounds := 0
	for time.Now().Before(deadline) {
		sum = sha256.Sum256(append(seed, byte(rounds), byte(rounds>>8), byte(rounds>>16)))
		seed = sum[:]
		rounds++
	}
	return hex.EncodeToString(sum[:8]), rounds
}

func doIO(dataDir string, mb int) (int64, string, error) {
	id := atomic.AddUint64(&requestID, 1)
	path := filepath.Join(dataDir, fmt.Sprintf("payload-%d.bin", id))
	file, err := os.Create(path)
	if err != nil {
		return 0, "", err
	}

	block := make([]byte, 1024*1024)
	for i := range block {
		block[i] = byte((i + int(id)) % 251)
	}

	var written int64
	for i := 0; i < mb; i++ {
		n, err := file.Write(block)
		written += int64(n)
		if err != nil {
			_ = file.Close()
			return written, "", err
		}
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return written, "", err
	}
	if err := file.Close(); err != nil {
		return written, "", err
	}
	defer os.Remove(path)

	readBack, err := os.Open(path)
	if err != nil {
		return written, "", err
	}
	defer readBack.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, readBack); err != nil {
		return written, "", err
	}
	return written, hex.EncodeToString(hash.Sum(nil)[:8]), nil
}

func intParam(r *http.Request, key string, fallback int) int {
	raw := r.URL.Query().Get(key)
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
