from conans import ConanFile, CMake

class MymathConan(ConanFile):
    name = "mymath"
    version = "1.0.0"
    license = "MIT"
    author = "Your Name"
    url = "https://github.com/yourname/mymath"
    description = "A simple C++ math library"
    topics = ("math", "cpp", "library")
    settings = "os", "compiler", "build_type", "arch"
    options = {"shared": [True, False], "fPIC": [True, False]}
    default_options = {"shared": False, "fPIC": True}
    generators = "cmake"
    exports_sources = "CMakeLists.txt", "src/*", "include/*"
    
    def config_options(self):
        if self.settings.os == "Windows":
            del self.options.fPIC
    
    def configure(self):
        if self.options.shared:
            self.options.fPIC = False
            
    def build(self):
        cmake = CMake(self)
        cmake.configure()
        cmake.build()
    
    def package(self):
        cmake = CMake(self)
        cmake.install()
    
    def package_info(self):
        self.cpp_info.libs = ["mymath"]
        self.cpp_info.includedirs = ["include"]
