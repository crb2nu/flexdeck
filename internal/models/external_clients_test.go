package models

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestHuggingFaceSearchAndFilesUseAPIContracts(t *testing.T) {
	var searchSeen bool
	client := NewHuggingFaceClient("hf-token")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if got := req.Header.Get("Authorization"); got != "Bearer hf-token" {
			t.Fatalf("expected auth header, got %q", got)
		}

		switch {
		case req.URL.Path == "/api/models" && req.URL.Query().Get("search") == "llama":
			searchSeen = true
			if req.URL.Query().Get("filter") != "text-generation" || req.URL.Query().Get("limit") != "3" {
				t.Fatalf("unexpected search query: %s", req.URL.RawQuery)
			}
			return jsonResponse(http.StatusOK, `[{"id":"org/llama","pipeline_tag":"text-generation","downloads":42}]`), nil
		case req.URL.Path == "/api/models/org/llama/tree/main":
			return jsonResponse(http.StatusOK, `[
				{"type":"file","path":"model.safetensors","size":10,"lfs":{"size":2048}},
				{"type":"file","path":"config.json","size":128},
				{"type":"directory","path":"refs","size":9999}
			]`), nil
		default:
			t.Fatalf("unexpected HuggingFace request: %s", req.URL.String())
			return nil, nil
		}
	})}

	models, err := client.Search(context.Background(), "llama", "text-generation", 3)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if !searchSeen || len(models) != 1 || models[0].ID != "org/llama" {
		t.Fatalf("unexpected search result: %+v", models)
	}

	size, err := client.GetTotalSize(context.Background(), "org/llama")
	if err != nil {
		t.Fatalf("GetTotalSize returned error: %v", err)
	}
	if size != 2176 {
		t.Fatalf("expected total size 2176, got %d", size)
	}
}

func TestHuggingFaceGetModelErrorContracts(t *testing.T) {
	tests := map[string]struct {
		status  int
		body    string
		wantErr string
	}{
		"not found":      {status: http.StatusNotFound, body: `{"error":"missing"}`, wantErr: "model not found"},
		"malformed json": {status: http.StatusOK, body: `{broken`, wantErr: "decode response"},
		"api error":      {status: http.StatusBadGateway, body: `upstream down`, wantErr: "API error 502"},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			client := NewHuggingFaceClient("")
			client.httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				return jsonResponse(tt.status, tt.body), nil
			})}

			_, err := client.GetModel(context.Background(), "org/missing")
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}

func TestCivitAISearchAndModelConversionContracts(t *testing.T) {
	client := NewCivitAIClient("civit-token")
	client.httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if got := req.Header.Get("Authorization"); got != "Bearer civit-token" {
			t.Fatalf("expected auth header, got %q", got)
		}
		if req.URL.Path != "/api/v1/models" {
			t.Fatalf("unexpected CivitAI path: %s", req.URL.Path)
		}
		if req.URL.Query().Get("query") != "portrait" || req.URL.Query().Get("types") != string(CivitTypeCheckpoint) {
			t.Fatalf("unexpected CivitAI query: %s", req.URL.RawQuery)
		}
		if req.URL.Query().Get("nsfw") != "false" || req.URL.Query().Get("limit") != "2" {
			t.Fatalf("expected safe limited search query, got %s", req.URL.RawQuery)
		}
		return jsonResponse(http.StatusOK, `{
			"items":[{
				"id":101,
				"name":"Portrait XL",
				"type":"Checkpoint",
				"description":"<p>studio<br>portrait</p>",
				"tags":["sdxl"],
				"creator":{"username":"maker"},
				"stats":{"downloadCount":7,"favoriteCount":3,"rating":4.8},
				"modelVersions":[{
					"id":202,
					"baseModel":"SDXL 1.0",
					"downloadUrl":"https://example.test/version",
					"files":[
						{"name":"preview.txt","sizeKB":1,"downloadUrl":"https://example.test/preview"},
						{"name":"model.safetensors","sizeKB":2.5,"downloadUrl":"https://example.test/model","primary":true}
					]
				}]
			}],
			"metadata":{"totalItems":1}
		}`), nil
	})}

	results, err := client.Search(context.Background(), "portrait", CivitTypeCheckpoint, 2)
	if err != nil {
		t.Fatalf("Search returned error: %v", err)
	}
	if len(results) != 1 || results[0].Name != "Portrait XL" {
		t.Fatalf("unexpected CivitAI results: %+v", results)
	}

	model := client.ToModel(&results[0])
	if model.ID != "civitai-101" || model.Type != TypeDiffusion {
		t.Fatalf("unexpected converted model identity: %+v", model)
	}
	if model.Size != int64(2.5*1024) {
		t.Fatalf("expected primary file size, got %d", model.Size)
	}
	if model.Metadata["download_url"] != "https://example.test/model" || model.Metadata["base_model"] != "SDXL 1.0" {
		t.Fatalf("expected download metadata, got %+v", model.Metadata)
	}
	if strings.Contains(model.Description, "<p>") || !strings.Contains(model.Description, "studio\nportrait") {
		t.Fatalf("expected sanitized description, got %q", model.Description)
	}
}

func TestCivitAIGetModelErrorContracts(t *testing.T) {
	tests := map[string]struct {
		status  int
		body    string
		wantErr string
	}{
		"not found":      {status: http.StatusNotFound, body: `missing`, wantErr: "model not found"},
		"api error":      {status: http.StatusTooManyRequests, body: `rate limit`, wantErr: "API error 429"},
		"malformed json": {status: http.StatusOK, body: `{broken`, wantErr: "decode response"},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			client := NewCivitAIClient("")
			client.httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				return jsonResponse(tt.status, tt.body), nil
			})}

			_, err := client.GetModel(context.Background(), 404)
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tt.wantErr, err)
			}
		})
	}
}
