// quill-avatars: small square thumbnails of profile pictures, for Quill. The browser asks /avatar?u=<picture url>&s=96 on Quill's own site; this
// service fetches the picture ONCE (so the picture's host sees this server's address, not the reader's), makes a square JPEG of that size, keeps it
// on disk, and serves it. A 4 MB animated GIF becomes a few kilobytes.
//
// It fetches addresses it is given, so it is careful about what it fetches: https only, port 443, public addresses only (checked when connecting,
// so a name that resolves to a private address is refused even after a redirect), at most 8 MB and 10 s, images only, no giant dimensions,
// a few requests per second per client and a few fetches at a time. Failures are remembered for a while, so a broken picture is not asked again and again.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxBytes   = 8 << 20
	maxPixels  = 40_000_000 // width*height of the source: anything bigger is a decompression bomb, not a profile picture
	fetchLimit = 10 * time.Second
	keepFor    = 7 * 24 * time.Hour
	failFor    = time.Hour
)

var sizes = map[int]bool{48: true, 96: true, 192: true}

// publicIP: not loopback, private, link-local, CGNAT, unique-local, multicast or unspecified.
func publicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1]&0xc0 == 64 { // 100.64.0.0/10 (CGNAT, Tailscale)
			return false
		}
		if v4[0] == 0 || v4[0] >= 224 || (v4[0] == 192 && v4[1] == 0 && v4[2] == 0) || (v4[0] == 198 && (v4[1] == 18 || v4[1] == 19)) {
			return false
		}
	}
	return true
}

var errNotPublic = errors.New("not a public address")

// The dialer checks the address it actually connects to: a DNS answer cannot point it at this machine or the private network, redirects included.
var client = &http.Client{
	Timeout: fetchLimit,
	Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil || port != "443" {
				return nil, errNotPublic
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				if publicIP(ip.IP) {
					return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
				}
			}
			return nil, errNotPublic
		},
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 8 * time.Second,
		MaxIdleConnsPerHost:   2,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || req.URL.Scheme != "https" {
			return errors.New("redirect refused")
		}
		return nil
	},
}

// validURL: an https address on the default port, no credentials, a sane length.
func validURL(raw string) (*url.URL, bool) {
	if len(raw) == 0 || len(raw) > 600 {
		return nil, false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" || (u.Port() != "" && u.Port() != "443") {
		return nil, false
	}
	if ip := net.ParseIP(u.Hostname()); ip != nil && !publicIP(ip) {
		return nil, false
	}
	return u, true
}

// thumb: decode (first frame of a GIF), crop to the centre square, scale to size, flatten on a dark background, JPEG.
func thumb(data []byte, size int) ([]byte, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxPixels {
		return nil, errors.New("image too large")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	side := b.Dx()
	if b.Dy() < side {
		side = b.Dy()
	}
	crop := image.Rect(b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2, 0, 0)
	crop.Max = crop.Min.Add(image.Pt(side, side))
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{color.RGBA{0x1f, 0x2a, 0x3a, 0xff}}, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, crop, draw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

type server struct {
	dir      string
	fetches  chan struct{} // at most this many pictures being fetched at once
	mu       sync.Mutex
	calls    map[string][]time.Time
	inFlight map[string]*sync.WaitGroup
}

func (s *server) allow(who string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	recent := s.calls[who][:0]
	for _, t := range s.calls[who] {
		if now.Sub(t) < 10*time.Second {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 120 { // a page of avatars is a few dozen; this only stops a flood
		s.calls[who] = recent
		return false
	}
	s.calls[who] = append(recent, now)
	if len(s.calls) > 5000 {
		s.calls = map[string][]time.Time{}
	}
	return true
}

func (s *server) path(raw string, size int) string {
	h := sha256.Sum256([]byte(raw))
	return filepath.Join(s.dir, hex.EncodeToString(h[:16])+"-"+strconv.Itoa(size))
}

// fresh: a cached file younger than its time to live.
func fresh(p string, ttl time.Duration) bool {
	st, err := os.Stat(p)
	return err == nil && time.Since(st.ModTime()) < ttl
}

func (s *server) make(u *url.URL, size int, p string) error {
	s.fetches <- struct{}{}
	defer func() { <-s.fetches }()
	req, _ := http.NewRequest("GET", u.String(), nil)
	req.Header.Set("User-Agent", "quill-avatars/1 (+https://quill.hivescope.xyz)")
	req.Header.Set("Accept", "image/*")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "image/") && !strings.HasPrefix(ct, "application/octet-stream") {
		return fmt.Errorf("not an image: %s", ct)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxBytes {
		return errors.New("too big")
	}
	out, err := thumb(data, size)
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/avatar" || (r.Method != "GET" && r.Method != "HEAD") {
		http.NotFound(w, r)
		return
	}
	who := r.Header.Get("X-Forwarded-For") // set by Caddy, the only one who can reach this service
	if i := strings.IndexByte(who, ','); i >= 0 {
		who = who[:i]
	}
	if !s.allow(strings.TrimSpace(who)) {
		http.Error(w, "slow down", http.StatusTooManyRequests)
		return
	}
	raw := r.URL.Query().Get("u")
	size, _ := strconv.Atoi(r.URL.Query().Get("s"))
	u, ok := validURL(raw)
	if !ok || !sizes[size] {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	p := s.path(raw, size)
	if fresh(p+".fail", failFor) {
		http.Error(w, "unavailable", http.StatusNotFound)
		return
	}
	if !fresh(p, keepFor) {
		// one fetch per picture at a time: the others wait for it
		s.mu.Lock()
		wg, busy := s.inFlight[p]
		if !busy {
			wg = &sync.WaitGroup{}
			wg.Add(1)
			s.inFlight[p] = wg
		}
		s.mu.Unlock()
		if busy {
			wg.Wait()
		} else {
			err := s.make(u, size, p)
			if err != nil {
				_ = os.WriteFile(p+".fail", nil, 0o644)
				log.Printf("%s: %v", u.Host, err)
			} else {
				_ = os.Remove(p + ".fail")
			}
			s.mu.Lock()
			delete(s.inFlight, p)
			s.mu.Unlock()
			wg.Done()
		}
	}
	data, err := os.ReadFile(p)
	if err != nil {
		http.Error(w, "unavailable", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}

// sweep: drop thumbnails and failure marks older than their time, every hour.
func (s *server) sweep() {
	for {
		entries, _ := os.ReadDir(s.dir)
		for _, e := range entries {
			info, err := e.Info()
			if err != nil {
				continue
			}
			ttl := keepFor
			if strings.HasSuffix(e.Name(), ".fail") {
				ttl = failFor
			}
			if time.Since(info.ModTime()) > ttl*2 {
				_ = os.Remove(filepath.Join(s.dir, e.Name()))
			}
		}
		time.Sleep(time.Hour)
	}
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8790", "address to listen on (only Caddy should reach it)")
	dir := flag.String("dir", filepath.Join(os.Getenv("HOME"), ".cache", "quill-avatars"), "where thumbnails are kept")
	flag.Parse()
	if err := os.MkdirAll(*dir, 0o755); err != nil {
		log.Fatal(err)
	}
	s := &server{dir: *dir, fetches: make(chan struct{}, 6), calls: map[string][]time.Time{}, inFlight: map[string]*sync.WaitGroup{}}
	go s.sweep()
	log.Printf("quill-avatars on %s, cache %s", *listen, *dir)
	srv := &http.Server{Addr: *listen, Handler: s, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
