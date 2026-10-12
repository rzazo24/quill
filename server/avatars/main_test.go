package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestOnlyPublicAddresses(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.1.2.3", "172.19.0.1", "192.168.1.1", "100.64.0.5", "169.254.1.1", "::1", "fd00::1", "0.0.0.0", "224.0.0.1"} {
		if publicIP(net.ParseIP(s)) {
			t.Errorf("%s must not count as public", s)
		}
	}
	for _, s := range []string{"1.1.1.1", "140.82.112.3", "2606:4700::1111"} {
		if !publicIP(net.ParseIP(s)) {
			t.Errorf("%s is public", s)
		}
	}
}

func TestOnlyPlainHTTPSAddresses(t *testing.T) {
	for _, s := range []string{"http://img.example/a.png", "https://user:pw@img.example/a.png", "https://img.example:8080/a.png", "https://127.0.0.1/a.png", "https://[::1]/a", "ftp://x/y", "", "https://"} {
		if _, ok := validURL(s); ok {
			t.Errorf("%q must be refused", s)
		}
	}
	if _, ok := validURL("https://image.nostr.build/abc.jpg"); !ok {
		t.Error("a normal picture address must be accepted")
	}
}

func TestTheDialerRefusesNamesThatPointInside(t *testing.T) {
	_, err := client.Transport.(*http.Transport).DialContext(context.Background(), "tcp", "localhost:443")
	if err == nil {
		t.Fatal("localhost must be refused when connecting")
	}
	if _, err := client.Transport.(*http.Transport).DialContext(context.Background(), "tcp", "example.com:80"); err == nil {
		t.Fatal("only port 443")
	}
}

func encode(t *testing.T, kind string, w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 200, 255})
		}
	}
	var b bytes.Buffer
	switch kind {
	case "png":
		_ = png.Encode(&b, img)
	case "gif":
		_ = gif.Encode(&b, img, nil)
	}
	return b.Bytes()
}

func TestThumbnailsAreSmallSquareJPEGs(t *testing.T) {
	for _, kind := range []string{"png", "gif"} {
		out, err := thumb(encode(t, kind, 800, 500), 96)
		if err != nil {
			t.Fatal(kind, err)
		}
		img, err := jpeg.Decode(bytes.NewReader(out))
		if err != nil || img.Bounds().Dx() != 96 || img.Bounds().Dy() != 96 {
			t.Fatalf("%s: want a 96x96 jpeg, got %v %v", kind, img.Bounds(), err)
		}
		if len(out) > 20_000 {
			t.Fatalf("%s: %d bytes is not a thumbnail", kind, len(out))
		}
	}
	if _, err := thumb([]byte("<html>not an image</html>"), 96); err == nil {
		t.Fatal("not an image must fail")
	}
}

func TestBombsAreRefused(t *testing.T) {
	// a PNG header claiming 50000x50000 pixels
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, 1, 1)))
	data := b.Bytes()
	copy(data[16:24], []byte{0, 0, 0xc3, 0x50, 0, 0, 0xc3, 0x50})
	if _, err := thumb(data, 96); err == nil {
		t.Fatal("a giant image must be refused before decoding")
	}
}

func TestBadRequestsAndFloods(t *testing.T) {
	s := &server{dir: t.TempDir(), fetches: make(chan struct{}, 2), calls: map[string][]time.Time{}, inFlight: map[string]*sync.WaitGroup{}}
	get := func(q, ip string) int {
		r := httptest.NewRequest("GET", "/avatar"+q, nil)
		r.Header.Set("X-Forwarded-For", ip)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		return w.Code
	}
	if c := get("?u=http://x.example/a.png&s=96", "1.2.3.4"); c != 400 {
		t.Fatalf("http: %d", c)
	}
	if c := get("?u=https://x.example/a.png&s=97", "1.2.3.4"); c != 400 {
		t.Fatalf("odd size: %d", c)
	}
	if c := get("?u=https://10.0.0.1/a.png&s=96", "1.2.3.4"); c != 400 {
		t.Fatalf("private: %d", c)
	}
	last := 0
	for i := 0; i < 130; i++ {
		last = get("?u=bad&s=96", "9.9.9.9")
	}
	if last != 429 {
		t.Fatalf("a flood must be slowed down, got %d", last)
	}
	if c := get("?u=bad&s=96", "8.8.8.8"); c != 400 {
		t.Fatalf("another client is not affected: %d", c)
	}
}
