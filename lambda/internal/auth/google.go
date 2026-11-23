package auth

import (
	"context"
	"os"
	"sync"

	"github.com/coreos/go-oidc/v3/oidc"

	"money-diary/internal/model"
)

const (
	googleIssuer  = "https://accounts.google.com"
	googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"
)

var (
	verifier     *oidc.IDTokenVerifier
	verifierOnce sync.Once
	verifierErr  error
)

// claims は Google ID Token のペイロード
type claims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

func getVerifier(ctx context.Context) (*oidc.IDTokenVerifier, error) {
	verifierOnce.Do(func() {
		clientID := os.Getenv("GOOGLE_CLIENT_ID")
		if clientID == "" {
			verifierErr = &verifierInitError{"GOOGLE_CLIENT_ID 環境変数が設定されていません"}
			return
		}

		// Google の公開鍵 URL は固定なので、ディスカバリーの通信を省いてコールドスタートを短くする。
		// 鍵の取得は最初の検証時に行い、以降はキャッシュされる。
		keySet := oidc.NewRemoteKeySet(context.WithoutCancel(ctx), googleJWKSURL)
		verifier = oidc.NewVerifier(googleIssuer, keySet, &oidc.Config{
			ClientID:        clientID,
			SkipExpiryCheck: true,
		})
	})

	return verifier, verifierErr
}

type verifierInitError struct {
	msg string
}

func (e *verifierInitError) Error() string {
	return e.msg
}

// VerifyIDToken は Google ID Token を検証し、ユーザー情報を返す
func VerifyIDToken(ctx context.Context, token string) (*model.AuthUser, error) {
	v, err := getVerifier(ctx)
	if err != nil {
		return nil, err
	}

	idToken, err := v.Verify(ctx, token)
	if err != nil {
		return nil, err
	}

	var c claims
	if err := idToken.Claims(&c); err != nil {
		return nil, err
	}

	if c.Email == "" || !c.EmailVerified {
		return nil, &verifierInitError{"メールアドレスが未検証です"}
	}

	name := c.Name
	if name == "" {
		name = c.Email
	}

	return &model.AuthUser{
		Email:   c.Email,
		Name:    name,
		Picture: c.Picture,
	}, nil
}
