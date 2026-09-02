package main

import (
	"bytes"
	"fmt"
	"io"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func run(input io.Reader, output io.Writer) error {
	password, err := io.ReadAll(input)
	if err != nil {
		return fmt.Errorf("read password: %w", err)
	}
	password = bytes.TrimSpace(password)
	if len(password) == 0 {
		return fmt.Errorf("password must not be empty")
	}
	hash, err := bcrypt.GenerateFromPassword(password, bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if _, err := fmt.Fprintln(output, string(hash)); err != nil {
		return fmt.Errorf("write hash: %w", err)
	}
	return nil
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
