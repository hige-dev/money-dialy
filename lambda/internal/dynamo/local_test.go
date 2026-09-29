package dynamo

import "testing"

func TestLocalEndpoint(t *testing.T) {
	for _, endpoint := range []string{"https://dynamodb.ap-northeast-1.amazonaws.com", "http://localhost:8000", "http://192.168.1.2:8000", "http://127.0.0.1:8000/path", "http://user@127.0.0.1:8000", "http://127.0.0.1:8000?target=remote"} {
		if _, err := NewLocalClient(endpoint); err == nil {
			t.Errorf("ローカル以外の接続先が許可されました: %s", endpoint)
		}
	}
	for _, endpoint := range []string{"http://127.0.0.1:8000", "http://[::1]:8000"} {
		if _, err := NewLocalClient(endpoint); err != nil {
			t.Errorf("ループバック接続に失敗: %v", err)
		}
	}
}
