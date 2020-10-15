# Frontend to dune

default:
	dune build

test:
	dune exe ./test/testsuite.exe

bench:
	./bench/runner.sh

utop:
	dune utop

fmt:
	dune build @fmt --auto-promote

clean:
	dune clean
# Optionally, remove all files/folders ignored by git as defined
# in .gitignore (-X).
	git clean -dfXq

.PHONY: default test bench utop fmt clean
