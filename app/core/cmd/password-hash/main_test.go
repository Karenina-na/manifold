package main

import (
	"bytes"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestRunHashesPasswordFromStandardInput(t *testing.T) {
	var output bytes.Buffer
	if err := run(strings.NewReader("a generated password"), &output); err != nil {
		t.Fatal(err)
	}
	hash := strings.TrimSpace(output.String())
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("a generated password")); err != nil {
		t.Fatalf("generated hash does not match password: %v", err)
	}
}

func TestRunRejectsEmptyPassword(t *testing.T) {
	if err := run(strings.NewReader(""), &bytes.Buffer{}); err == nil {
		t.Fatal("expected empty password to be rejected")
	}
}
