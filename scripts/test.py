#!/usr/bin/env python3
"""Run MQTT tests one by one with timeout support."""

import argparse
import signal
import sys
import os
import time
import unittest
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Run MQTT tests one by one with timeout")
    parser.add_argument("--host", default="localhost", help="MQTT broker hostname")
    parser.add_argument("--port", type=int, default=1883, help="MQTT broker port")
    parser.add_argument("--timeout", type=int, default=60, help="Timeout per test in seconds")
    parser.add_argument("--v5-only", action="store_true", help="Run only V5 tests")
    parser.add_argument("--v3-only", action="store_true", help="Run only V3 tests")
    parser.add_argument("--tests", nargs="*", help="Specific test methods to run")
    args = parser.parse_args()

    if args.tests:
        # Expand test names
        expanded = []
        for t in args.tests:
            expanded.extend(t.split(","))
        args.tests = expanded

    return args


class TestRunner:
    def __init__(self, test_module, host, port, timeout):
        self.module = test_module
        self.host = host
        self.port = port
        self.timeout = timeout
        self.results = []

    def get_test_methods(self):
        """Use unittest.TestLoader to discover tests."""
        loader = unittest.TestLoader()
        suite = loader.loadTestsFromTestCase(self.module.Test)
        return [test._testMethodName for test in suite]

    def run_with_timeout(self, test_method):
        """Run a test with timeout using signal."""
        def handler(signum, frame):
            raise TimeoutError("Test timed out after {} seconds".format(self.timeout))

        signal.signal(signal.SIGALRM, handler)
        signal.alarm(self.timeout)

        try:
            test_method()
            signal.alarm(0)
            return "PASSED", None
        except TimeoutError as e:
            signal.alarm(0)
            return "TIMED OUT", str(e)
        except Exception as e:
            signal.alarm(0)
            return "FAILED", str(e)

    def run(self, specific_tests=None):
        all_tests = self.get_test_methods()

        if specific_tests:
            tests = [t for t in all_tests if t in specific_tests or any(s in t for s in specific_tests)]
        else:
            tests = all_tests

        if not tests:
            print("No tests found")
            return True

        print("Found {} test(s):".format(len(tests)))
        for i, t in enumerate(tests, 1):
            print("  {}. {}".format(i, t))
        print()

        passed = 0
        failed = 0
        timed_out = 0

        # Setup once for all tests
        self.module.host = self.host
        self.module.port = self.port
        if hasattr(self.module, 'setData'):
            self.module.setData()

        # Call setUpClass properly (it's a classmethod, needs the class as argument)
        self.module.Test.setUpClass()

        for test_name in tests:
            print("-" * 60)
            print("Running: {} (timeout: {}s)".format(test_name, self.timeout))
            print("-" * 60)

            test_instance = self.module.Test(test_name)
            test_method = getattr(test_instance, test_name)

            status, error = self.run_with_timeout(test_method)
            self.results.append((test_name, status, error))

            if status == "PASSED":
                print("✓ PASSED")
                passed += 1
            elif status == "TIMED OUT":
                print("✗ TIMED OUT")
                timed_out += 1
            else:
                print("✗ FAILED: {}".format(error))
                failed += 1

            print()

        # Summary
        print("=" * 60)
        print("SUMMARY")
        print("=" * 60)
        for name, status, error in self.results:
            symbol = "✓" if status == "PASSED" else "✗"
            print("  {} {}: {}".format(symbol, name, status))
            if error:
                print("    {}".format(error))

        print()
        print("Total: {} | Passed: {} | Failed: {} | Timed out: {}".format(
            len(tests), passed, failed, timed_out))

        return failed == 0 and timed_out == 0


def load_test_module(test_file, test_dir):
    """Load test module from file."""
    import importlib.util

    sys.path.insert(0, test_dir)

    module_name = Path(test_file).stem
    spec = importlib.util.spec_from_file_location(
        module_name, os.path.join(test_dir, test_file))
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    return module


def main():
    args = parse_args()

    test_dir = Path(__file__).parent.parent / "paho.mqtt.testing" / "interoperability"

    if not test_dir.exists():
        print("ERROR: Test directory not found: {}".format(test_dir))
        print("Try: git submodule update --init --recursive")
        sys.exit(1)

    success = True

    if not args.v3_only:
        print("\n" + "=" * 60)
        print("MQTT V5 TESTS")
        print("=" * 60 + "\n")

        try:
            module = load_test_module("client_test5.py", str(test_dir))
            runner = TestRunner(module, args.host, args.port, args.timeout)
            success = runner.run(args.tests) and success
        except Exception as e:
            print("ERROR loading V5 tests: {}".format(e))
            import traceback
            traceback.print_exc()
            success = False

    if not args.v5_only:
        print("\n" + "=" * 60)
        print("MQTT V3 TESTS")
        print("=" * 60 + "\n")

        try:
            module = load_test_module("client_test.py", str(test_dir))
            module.topics = ("TopicA", "TopicA/B", "Topic/C", "TopicA/C", "/TopicA")
            module.wildtopics = ("TopicA/+", "+/C", "#", "/#", "/+", "+/+", "TopicA/#")
            module.nosubscribe_topics = ("test/nosubscribe",)
            module.host = args.host
            module.port = args.port
            runner = TestRunner(module, args.host, args.port, args.timeout)
            success = runner.run(args.tests) and success
        except Exception as e:
            print("ERROR loading V3 tests: {}".format(e))
            import traceback
            traceback.print_exc()
            success = False

    if not success:
        sys.exit(1)

    print("\n✓ All tests passed!")
    sys.exit(0)


if __name__ == "__main__":
    main()
