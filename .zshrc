#
# Executes commands at the start of an interactive session.
#
# Authors:
#   Sorin Ionescu <sorin.ionescu@gmail.com>
#

# Source Prezto.
if [[ -s "${ZDOTDIR:-$HOME}/.zprezto/init.zsh" ]]; then
  source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"
fi

# Customize to your needs...

export FZF_DEFAULT_OPTS='--height 40% --reverse --border'

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh


export PATH=$HOME/.nodebrew/current/bin:$PATH
export PATH=/Users/yuuma/Library/Android/sdk/tools/bin:$PATH


# tabtab source for serverless package
# uninstall by removing these lines or running `tabtab uninstall serverless`
[[ -f /Users/yuuma/.nodebrew/node/v8.11.3/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh ]] && . /Users/yuuma/.nodebrew/node/v8.11.3/lib/node_modules/serverless/node_modules/tabtab/.completions/serverless.zsh
# tabtab source for sls package
# uninstall by removing these lines or running `tabtab uninstall sls`
[[ -f /Users/yuuma/.nodebrew/node/v8.11.3/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh ]] && . /Users/yuuma/.nodebrew/node/v8.11.3/lib/node_modules/serverless/node_modules/tabtab/.completions/sls.zsh
###-tns-completion-start-###
if [ -f /Users/yuuma/.tnsrc ]; then 
    source /Users/yuuma/.tnsrc 
fi
###-tns-completion-end-###

export JAVA_HOME=$(/usr/libexec/java_home)
export ANDROID_HOME=/Users/yuuma/Library/Android/sdk
