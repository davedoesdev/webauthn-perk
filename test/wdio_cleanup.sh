#!/bin/bash
if pgrep -f geckodriver; then
  exec pkill -f geckodriver
fi
